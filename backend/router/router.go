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

    // Admin routes - only admins can modify servers, projects, apps
    admin := auth.Group("/")
    admin.Use(middleware.Admin())

    admin.POST("/servers", controllers.CreateServer(db))
    admin.PUT("/servers/:id", controllers.UpdateServer(db))
    admin.DELETE("/servers/:id", controllers.DeleteServer(db))

    admin.POST("/projects", controllers.CreateProject(db))
    admin.PUT("/projects/:id", controllers.UpdateProject(db))
    admin.DELETE("/projects/:id", controllers.DeleteProject(db))

    admin.POST("/apps", controllers.CreateApp(db))
    admin.DELETE("/apps/:id", controllers.DeleteApp(db))

    // User management (admin only)
    admin.GET("/users", controllers.ListUsers(db))
    admin.POST("/users", controllers.CreateUser(db))
    admin.GET("/users/:id", controllers.GetUser(db))
    admin.PUT("/users/:id", controllers.UpdateUser(db))
    admin.DELETE("/users/:id", controllers.DeleteUser(db))

    return r
}
