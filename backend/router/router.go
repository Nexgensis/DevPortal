package router

import (
    "backend/controllers"
    "backend/middleware"
    "github.com/gin-contrib/cors"
    "github.com/gin-gonic/gin"
    "gorm.io/gorm"
)

func SetupRouter(db *gorm.DB) *gin.Engine {
    r := gin.Default()
    
    // Add CORS middleware
    r.Use(cors.New(cors.Config{
        AllowOrigins:     []string{"*"}, // Allow all origins for now
        AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
        AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
        ExposeHeaders:    []string{"Content-Length"},
        AllowCredentials: false, // Must be false when AllowOrigins is "*"
    }))

    // Public auth routes (login - no JWT required)
    r.POST("/api/auth/login", controllers.Login(db))
    r.POST("/api/auth/register", controllers.Register(db))
    
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
    auth.POST("/servers/:id/postgres/containers/:container_id/test", controllers.TestPostgresConnection(db))
    auth.POST("/postgres/dump", controllers.CreatePostgresDump(db))
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

    // Admin routes - only admins can modify servers, projects, apps
    admin := auth.Group("/")
    admin.Use(middleware.Admin())

    admin.POST("/servers", controllers.CreateServer(db))
    admin.PUT("/servers/:id", controllers.UpdateServer(db))
    admin.DELETE("/servers/:id", controllers.DeleteServer(db))

    // PostgreSQL credential mutations (admin only)
    admin.PUT("/servers/:id/postgres/credentials", controllers.UpsertPostgresCredential(db))
    admin.DELETE("/servers/:id/postgres/credentials/:container_name", controllers.DeletePostgresCredential(db))

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
