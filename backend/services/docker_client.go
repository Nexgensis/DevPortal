package services

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/http"
	"time"

	"backend/models"
	"backend/utils"

	"github.com/docker/docker/client"
)

// NewDockerClient builds a Docker Engine API client for a server over mutual TLS.
//
// The server stores three PEM blobs: the CA certificate and client certificate
// in plain text, and the client private key AES-encrypted at rest. We decrypt
// the key, assemble a tls.Config, and hand the SDK an http.Client wired to it,
// targeting https://<address>:<docker_api_port>.
//
// Callers MUST `defer cli.Close()` the returned client to avoid leaking the
// underlying HTTP transport connections.
func NewDockerClient(server *models.Server) (*client.Client, error) {
	if server.TLSCA == "" || server.TLSCert == "" || server.TLSKey == "" {
		return nil, fmt.Errorf("server %q is missing mTLS material (ca/cert/key)", server.Name)
	}

	// The private key is encrypted at rest; the CA and client cert are plain PEM.
	privKey, err := utils.Decrypt(server.TLSKey)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt client TLS key: %w", err)
	}

	cert, err := tls.X509KeyPair([]byte(server.TLSCert), []byte(privKey))
	if err != nil {
		return nil, fmt.Errorf("invalid client certificate/key pair: %w", err)
	}

	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM([]byte(server.TLSCA)) {
		return nil, fmt.Errorf("failed to parse CA certificate")
	}

	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		RootCAs:      caPool,
		MinVersion:   tls.VersionTLS12,
	}

	httpClient := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig:     tlsConfig,
			TLSHandshakeTimeout: 10 * time.Second,
			// Bound the TCP connect. A host that is powered off or firewalled
			// with DROP never completes the handshake and never sends a RST, so
			// without this the dial blocks until the OS gives up (minutes) and
			// endpoints like /running-apps hang with no response at all.
			DialContext: (&net.Dialer{
				Timeout:   5 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
		},
		// No overall timeout: dumps can stream for a long time. Per-operation
		// deadlines are enforced by the context passed to each SDK call.
	}

	host := fmt.Sprintf("tcp://%s:%d", server.Address, server.DockerAPIPort)
	cli, err := client.NewClientWithOpts(
		client.WithHost(host),
		client.WithScheme("https"),
		client.WithHTTPClient(httpClient),
		client.WithAPIVersionNegotiation(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create docker client: %w", err)
	}

	return cli, nil
}
