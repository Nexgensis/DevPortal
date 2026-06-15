package controllers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// dump-stats endpoint shape — kept as Go structs (not free maps) so the JSON
// keys are stable and the Vite/TS side can model them safely. All counts are
// scoped to the postgres_dump action; the time window is the last 30 days for
// trend/most-dumped/top-users and the current calendar month for the totals.

type dumpCountByName struct {
	Database string `json:"database"`
	Count    int64  `json:"count"`
}

type dumpCountByUser struct {
	Username string `json:"username"`
	Count    int64  `json:"count"`
}

type dumpTrendBucket struct {
	Date  string `json:"date"`  // YYYY-MM-DD
	Count int64  `json:"count"`
}

type dumpTotalsThisMonth struct {
	Count     int64 `json:"count"`
	SizeBytes int64 `json:"sizeBytes"` // sums size_bytes from new JSON-format details only (0 until Phase 2 data accumulates)
}

type dumpStatsResponse struct {
	MostDumpedDatabases []dumpCountByName   `json:"mostDumpedDatabases"`
	TopUsers            []dumpCountByUser   `json:"topUsers"`
	TotalThisMonth      dumpTotalsThisMonth `json:"totalThisMonth"`
	Trend               []dumpTrendBucket   `json:"trend"`
}

// GetDumpStats returns aggregate metrics for the Database Dump page. Drives
// the stats strip (most-dumped DBs, top users, totals, daily trend). Reads
// audit_logs where action = 'postgres_dump'.
func GetDumpStats(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		windowStart := time.Now().AddDate(0, 0, -30)

		out := dumpStatsResponse{
			MostDumpedDatabases: []dumpCountByName{},
			TopUsers:            []dumpCountByUser{},
			Trend:               []dumpTrendBucket{},
		}

		// Most-dumped databases (last 30d, top 5).
		db.Table("audit_logs").
			Select("resource_name AS database, COUNT(*) AS count").
			Where("action = ? AND created_at > ? AND deleted_at IS NULL", "postgres_dump", windowStart).
			Group("resource_name").
			Order("count DESC").
			Limit(5).
			Scan(&out.MostDumpedDatabases)

		// Top users by dump count (last 30d, top 5).
		db.Table("audit_logs").
			Select("username, COUNT(*) AS count").
			Where("action = ? AND created_at > ? AND deleted_at IS NULL", "postgres_dump", windowStart).
			Group("username").
			Order("count DESC").
			Limit(5).
			Scan(&out.TopUsers)

		// Totals for the current calendar month — count covers every dump
		// attempt (old + new format), size only sums new JSON-format rows.
		// The 'details LIKE {%' predicate cheaply skips legacy plain-text rows
		// so the jsonb cast never fails.
		monthStart := time.Date(time.Now().Year(), time.Now().Month(), 1, 0, 0, 0, 0, time.Local)
		db.Table("audit_logs").
			Where("action = ? AND created_at >= ? AND deleted_at IS NULL", "postgres_dump", monthStart).
			Count(&out.TotalThisMonth.Count)
		db.Table("audit_logs").
			Select("COALESCE(SUM((details::jsonb->>'size_bytes')::bigint), 0) AS size_bytes").
			Where("action = ? AND created_at >= ? AND deleted_at IS NULL AND details LIKE '{%'", "postgres_dump", monthStart).
			Scan(&out.TotalThisMonth.SizeBytes)

		// Daily trend over the last 30 days. Dates returned as YYYY-MM-DD so
		// the sparkline can plot them without re-parsing.
		db.Table("audit_logs").
			Select("TO_CHAR(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, COUNT(*) AS count").
			Where("action = ? AND created_at > ? AND deleted_at IS NULL", "postgres_dump", windowStart).
			Group("date").
			Order("date ASC").
			Scan(&out.Trend)

		c.JSON(http.StatusOK, out)
	}
}
