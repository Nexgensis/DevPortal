package services

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"backend/models"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"

	"gorm.io/gorm"
)

// composeLabel is the label Docker Compose stamps on every container it creates,
// keyed by project name. We use it to find an app's containers over the Engine API.
const composeLabel = "com.docker.compose.project"

var nonComposeProjectChars = regexp.MustCompile(`[^a-z0-9_-]`)

func GetServerByID(db *gorm.DB, serverID string) (models.Server, error) {
	var server models.Server
	if result := db.First(&server, "id = ?", serverID); result.Error != nil {
		return models.Server{}, result.Error
	}
	return server, nil
}

// composeProjectName derives the Docker Compose project name from a compose path
// the same way the compose CLI does by default: the lowercased base directory
// name with any characters outside [a-z0-9_-] stripped.
func composeProjectName(composePath string) string {
	base := filepath.Base(strings.TrimRight(composePath, "/"))
	return nonComposeProjectChars.ReplaceAllString(strings.ToLower(base), "")
}

// StartComposeApp starts the containers belonging to the app's compose project.
//
// Migrated from SSH `docker-compose up -d` to the Docker Engine API: we locate
// the project's containers by their compose label and start them. This assumes
// the compose project's containers already exist on the host (deployed once);
// it toggles them on rather than re-creating from the compose file.
func StartComposeApp(server models.Server, composePath string) (string, error) {
	return setComposeProjectState(server, composePath, true)
}

// StopComposeApp stops the containers belonging to the app's compose project.
func StopComposeApp(server models.Server, composePath string) (string, error) {
	return setComposeProjectState(server, composePath, false)
}

func setComposeProjectState(server models.Server, composePath string, start bool) (string, error) {
	project := composeProjectName(composePath)
	action := "stop"
	if start {
		action = "start"
	}
	log.Printf("Docker API %s for compose project %q on %s", action, project, server.Address)

	cli, err := NewDockerClient(&server)
	if err != nil {
		return "", err
	}
	defer cli.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	list, err := cli.ContainerList(ctx, container.ListOptions{
		All:     true,
		Filters: filters.NewArgs(filters.Arg("label", composeLabel+"="+project)),
	})
	if err != nil {
		return "", fmt.Errorf("failed to list compose containers: %w", err)
	}
	if len(list) == 0 {
		return "", fmt.Errorf("no containers found for compose project %q — has it been deployed?", project)
	}

	var affected []string
	for _, c := range list {
		if start {
			if err := cli.ContainerStart(ctx, c.ID, container.StartOptions{}); err != nil {
				return "", fmt.Errorf("failed to start container %s: %w", c.ID[:12], err)
			}
		} else {
			if err := cli.ContainerStop(ctx, c.ID, container.StopOptions{}); err != nil {
				return "", fmt.Errorf("failed to stop container %s: %w", c.ID[:12], err)
			}
		}
		name := c.ID
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		affected = append(affected, name)
	}

	return fmt.Sprintf("%sed %d container(s): %s", action, len(affected), strings.Join(affected, ", ")), nil
}
