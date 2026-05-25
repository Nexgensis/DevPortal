package services

import (
	"context"
	"fmt"
	"log"
	"net"
	"time"

	"backend/models"

	"github.com/docker/docker/api/types/container"
)

// CheckServerStatus tests connectivity to a server's Docker Engine API over mTLS.
func CheckServerStatus(server models.Server) (string, error) {
	log.Printf("Testing Docker API connection to server %s (%s:%d)",
		server.Name, server.Address, server.DockerAPIPort)

	if server.Address == "" {
		return "offline", fmt.Errorf("server address is empty")
	}

	// Quick TCP reachability probe against the Docker API port first — gives a
	// fast, clear failure before we attempt the (more expensive) TLS handshake.
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", server.Address, server.DockerAPIPort), 5*time.Second)
	if err != nil {
		log.Printf("Server %s (%s:%d) network connectivity failed: %v", server.Name, server.Address, server.DockerAPIPort, err)
		return "offline", fmt.Errorf("network connectivity failed: %w", err)
	}
	conn.Close()

	// If TLS material is configured, confirm the engine actually answers.
	if server.TLSCA != "" && server.TLSCert != "" && server.TLSKey != "" {
		cli, err := NewDockerClient(&server)
		if err != nil {
			log.Printf("Server %s (%s) docker client build failed: %v", server.Name, server.Address, err)
			return "offline", err
		}
		defer cli.Close()

		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()

		if _, err := cli.Ping(ctx); err != nil {
			log.Printf("Server %s (%s) docker API ping failed: %v", server.Name, server.Address, err)
			return "offline", fmt.Errorf("docker API ping failed: %w", err)
		}
		log.Printf("Server %s (%s) is online via Docker API (mTLS)", server.Name, server.Address)
		return "online", nil
	}

	// No TLS material yet — report online based on network reachability only.
	log.Printf("Server %s (%s) reachable (network only, no mTLS material configured)", server.Name, server.Address)
	return "online", nil
}

// GetRunningContainersCount returns the number of running containers on a server.
func GetRunningContainersCount(server models.Server) (int, error) {
	cli, err := NewDockerClient(&server)
	if err != nil {
		return 0, err
	}
	defer cli.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	list, err := cli.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return 0, fmt.Errorf("failed to list containers: %w", err)
	}
	return len(list), nil
}

// UpdateServerStatus updates a server's status and running apps count.
func UpdateServerStatus(server *models.Server) {
	status, err := CheckServerStatus(*server)
	server.Status = status
	now := time.Now().Unix()
	server.LastChecked = &now

	if err == nil && status == "online" {
		if count, err := GetRunningContainersCount(*server); err == nil {
			server.RunningAppsCount = count
		}
	} else {
		server.RunningAppsCount = 0
	}
}
