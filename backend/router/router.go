package router

import (
    "os"
    "strings"

    "backend/controllers"
    "backend/middleware"
    "github.com/gin-contrib/cors"
    "github.com/gin-gonic/gin"
    "gorm.io/gorm"
)

// splitAndTrim turns "a, b ,c" into ["a","b","c"], dropping empties.
func splitAndTrim(csv string) []string {
    var out []string
    for _, p := range strings.Split(csv, ",") {
        if p = strings.TrimSpace(p); p != "" {
            out = append(out, p)
        }
    }
    return out
}

func SetupRouter(db *gorm.DB) *gin.Engine {
    r := gin.Default()

    // CORS. CORS_ALLOWED_ORIGINS is a comma-separated allowlist, e.g.
    // "https://portal.nexgensis.com,http://localhost:3000". It falls back to
    // FRONTEND_URL (already set for the SSO redirect) so a correctly configured
    // deployment needs no new variable.
    //
    // The previous "*" let any website on the internet script authenticated
    // requests against a console that can dump production databases. Kept
    // narrow deliberately: this API is only ever called by its own SPA.
    allowedOrigins := splitAndTrim(os.Getenv("CORS_ALLOWED_ORIGINS"))
    if len(allowedOrigins) == 0 {
        if fe := strings.TrimSpace(os.Getenv("FRONTEND_URL")); fe != "" {
            allowedOrigins = []string{fe}
        } else {
            // Local dev default — the Vite dev server.
            allowedOrigins = []string{"http://localhost:3000", "http://localhost:5173"}
        }
    }
    r.Use(cors.New(cors.Config{
        AllowOrigins:     allowedOrigins,
        AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
        AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
        ExposeHeaders:    []string{"Content-Length", "Content-Disposition"},
        AllowCredentials: false, // tokens travel in the Authorization header, not cookies
    }))

    // Public auth routes (login - no JWT required).
    // No public registration: accounts are created by an admin via POST /api/users,
    // or auto-provisioned by SSO when SSO_AUTO_CREATE_USERS=true. A self-serve
    // register endpoint would hand any anonymous caller a `user` role, which can
    // read every server and dump any database.
    r.POST("/api/auth/login", controllers.Login(db))

    // Static file server for wiki image uploads. Served unauthenticated so
    // <img src=> tags work for any reader (including the prod nginx that
    // proxies the SPA). Files land here from the auth-only POST /api/wiki/upload.
    // Pre-create the dir so gin.Static doesn't 404 every request before the
    // first upload happens.
    _ = os.MkdirAll("uploads/wiki", 0o755)
    r.Static("/uploads/wiki", "./uploads/wiki")
    
    // SSO routes
    r.GET("/api/auth/microsoft", controllers.MicrosoftLogin(db))
    r.GET("/api/auth/microsoft/callback", controllers.MicrosoftCallback(db))

    // Routes requiring any authenticated user
    auth := r.Group("/api")
    auth.Use(middleware.JWT())

    auth.GET("/auth/verify", controllers.Verify(db))

    // User routes (can see servers, projects, apps + start/stop apps)
    auth.GET("/servers", controllers.ListServers(db))
    auth.POST("/servers/refresh", controllers.RefreshAllServers(db))
    auth.POST("/servers/:id/test", controllers.TestServerConnection(db))
    auth.GET("/projects", controllers.ListProjects(db))
    auth.GET("/apps", controllers.ListApps(db))
    auth.POST("/apps/:id/start", controllers.StartApp(db))
    auth.POST("/apps/:id/stop", controllers.StopApp(db))
    auth.PUT("/apps/:id", controllers.UpdateApp(db)) // Allow users to update app settings (e.g., runtime)
    
    // User can view their own audit logs
    auth.GET("/audit-logs", controllers.GetAuditLogs(db))
    
    // PostgreSQL routes - available to all authenticated users
    auth.GET("/servers/:id/postgres/containers", controllers.GetPostgresContainers(db))
    auth.GET("/servers/:id/postgres/containers/:container_id/databases", controllers.GetPostgresDatabases(db))
    // Context — what compose project does this postgres container belong to,
    // which sibling containers use it, and which database is the live one?
    auth.GET("/servers/:id/postgres/containers/:container_id/context", controllers.GetPostgresContainerContext(db))
    auth.POST("/servers/:id/postgres/containers/:container_id/test", controllers.TestPostgresConnection(db))
    auth.POST("/postgres/dump", controllers.CreatePostgresDump(db))
    // Aggregate metrics for the Database Dump page (most-dumped, top users,
    // totals, trend). Reads audit_logs; no Docker calls.
    auth.GET("/postgres/dump-stats", controllers.GetDumpStats(db))
    // Fleet-wide live resource insights (top CPU/RAM consumers, per-server load)
    // across all servers. Cached + background-refreshed; cold cache returns
    // computing=true and the client polls.
    auth.GET("/fleet/resources", controllers.GetFleetResources(db))
    // Per-container PostgreSQL credentials — read for any authenticated user
    // (passwords are never returned); mutations are admin-only (registered below).
    auth.GET("/servers/:id/postgres/credentials", controllers.ListPostgresCredentials(db))

    // Security scan reports — read for any authenticated user; sources are
    // managed (added/removed/refreshed) by admins (registered below).
    auth.GET("/scan-reports", controllers.ListScanReports(db))
    auth.GET("/scan-reports/:id", controllers.GetScanReport(db))
    // Parsed/structured view: turns the raw stored JSON into a severity matrix +
    // tab-ready DTO (Trivy / ZAP / Sonar). Auth-only (read access matches /:id).
    auth.GET("/scan-reports/:id/parsed", controllers.GetParsedScanReport(db))

    // Running apps — live view of compose projects + their URLs per server.
    auth.GET("/servers/:id/running-apps", controllers.GetRunningApps(db))

    // Wiki — developer-onboarding posts (Hashnode-style). Read is open to any
    // authenticated user; write/delete is gated to admins OR the post's author
    // (the controller does the per-post author check).
    auth.GET("/wiki", controllers.ListWikiPosts(db))
    auth.GET("/wiki/:key", controllers.GetWikiPost(db))           // slug or UUID
    auth.POST("/wiki", controllers.CreateWikiPost(db))             // any authed user can author
    auth.PUT("/wiki/:id", controllers.UpdateWikiPost(db))          // author or admin (enforced inside)
    auth.DELETE("/wiki/:id", controllers.DeleteWikiPost(db))       // author or admin (enforced inside)
    // Image upload — any authed user. Returns a relative URL pointing at the
    // static handler registered below (/uploads/wiki/<filename>).
    auth.POST("/wiki/upload", controllers.UploadWikiImage(db))

    // Admin routes - only admins can modify servers, projects, apps
    admin := auth.Group("/")
    admin.Use(middleware.Admin())

    admin.POST("/servers", controllers.CreateServer(db))
    admin.PUT("/servers/:id", controllers.UpdateServer(db))
    admin.DELETE("/servers/:id", controllers.DeleteServer(db))

    // PostgreSQL credential mutations (admin only)
    admin.PUT("/servers/:id/postgres/credentials", controllers.UpsertPostgresCredential(db))
    admin.DELETE("/servers/:id/postgres/credentials/:container_name", controllers.DeletePostgresCredential(db))

    // PostgreSQL restore — admin-only since it creates new databases on the
    // container. Multipart upload; refuses if target_database already exists.
    admin.POST("/postgres/restore", controllers.RestorePostgresDump(db))

    // Security scan report sources (admin only)
    admin.POST("/scan-reports", controllers.CreateScanReport(db))
    admin.PUT("/scan-reports/:id", controllers.UpdateScanReport(db))
    admin.POST("/scan-reports/:id/refresh", controllers.RefreshScanReportHandler(db))
    admin.DELETE("/scan-reports/:id", controllers.DeleteScanReport(db))

    admin.POST("/projects", controllers.CreateProject(db))
    admin.PUT("/projects/:id", controllers.UpdateProject(db))
    admin.DELETE("/projects/:id", controllers.DeleteProject(db))

    admin.POST("/apps", controllers.CreateApp(db))
    admin.DELETE("/apps/:id", controllers.DeleteApp(db))

    // Pin/unpin a Running-Apps root-group on a server. Pinning is admin-only but
    // the effect (group sorts to the top) is visible to every viewer.
    admin.PUT("/servers/:id/running-apps/:group/pin", controllers.PinProject(db))
    admin.DELETE("/servers/:id/running-apps/:group/pin", controllers.UnpinProject(db))

    // User management (admin only)
    admin.GET("/users", controllers.ListUsers(db))
    admin.POST("/users", controllers.CreateUser(db))
    admin.GET("/users/:id", controllers.GetUser(db))
    admin.PUT("/users/:id", controllers.UpdateUser(db))
    admin.DELETE("/users/:id", controllers.DeleteUser(db))

    return r
}
