package controllers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// uploadsBaseDir is where uploaded wiki images land on disk. Relative path —
// resolves to /app/uploads/wiki inside the container (which is a bind-mount of
// ./backend/uploads/wiki on the dev host) so files survive `air` rebuilds.
// For prod, give this a named volume in docker-compose.yml so dumps survive
// container recreation.
const uploadsBaseDir = "uploads/wiki"

// uploadsURLPrefix is the public URL prefix the static-file handler serves
// from. Must match the StaticFS path in router.go.
const uploadsURLPrefix = "/uploads/wiki/"

// Image upload size cap. 5 MB is generous for cover images (most JPEGs/WebPs
// at reasonable quality come in well under 1 MB at 1600px wide).
const uploadMaxBytes = 5 * 1024 * 1024

// allowedImageMIMEs maps content types we accept to the filename extension we
// stamp on disk. Sniffed from the file's first 512 bytes — we do NOT trust the
// client-provided Content-Type or filename.
var allowedImageMIMEs = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// randomHex returns 2*n hex characters of crypto-random entropy. Used for the
// uploaded-file basename so authors can't collide / overwrite each other's
// files, and so the on-disk filename never reflects user input.
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// UploadWikiImage accepts a multipart "image" field, validates type + size,
// writes it to uploadsBaseDir, and returns the public URL the caller should
// store in `cover_image` (or embed in markdown).
//
// Auth: this route sits under the auth group in router.go — any authenticated
// user can upload. Quota / per-user limits are deferred to V2.
func UploadWikiImage(_ *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Cap the multipart body up-front so a giant upload can't allocate
		// memory before we get to check Size on the form file.
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, uploadMaxBytes+1024)

		fileHeader, err := c.FormFile("image")
		if err != nil {
			respondWithError(c, http.StatusBadRequest, "No image file in 'image' field")
			return
		}
		if fileHeader.Size > uploadMaxBytes {
			respondWithError(c, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("Image too large (max %d MB)", uploadMaxBytes/(1024*1024)))
			return
		}

		f, err := fileHeader.Open()
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to read upload")
			return
		}
		defer f.Close()

		// Sniff the real MIME from the file header bytes (Go's net/http detector
		// uses the same algorithm as browsers). We ignore the client-supplied
		// Content-Type and original filename — both are user-controlled.
		head := make([]byte, 512)
		n, _ := f.Read(head)
		head = head[:n]
		mime := http.DetectContentType(head)
		ext, ok := allowedImageMIMEs[mime]
		if !ok {
			respondWithError(c, http.StatusBadRequest, "Unsupported image type (allowed: jpg, png, webp, gif)")
			return
		}
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			respondWithError(c, http.StatusInternalServerError, "Read error during upload")
			return
		}

		// Filename = <random hex>-<ms timestamp><ext>. The timestamp helps with
		// debugging / ordering on disk; the random portion makes guessing other
		// users' uploads impractical.
		token, err := randomHex(8)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "RNG failed")
			return
		}
		name := fmt.Sprintf("%s-%d%s", token, time.Now().UnixMilli(), ext)

		if err := os.MkdirAll(uploadsBaseDir, 0o755); err != nil {
			respondWithError(c, http.StatusInternalServerError, "Storage init failed: "+err.Error())
			return
		}
		dest := filepath.Join(uploadsBaseDir, name)
		out, err := os.Create(dest)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to create file: "+err.Error())
			return
		}
		defer out.Close()
		if _, err := io.Copy(out, f); err != nil {
			// Best-effort cleanup so we don't leave a half-written file.
			_ = os.Remove(dest)
			respondWithError(c, http.StatusInternalServerError, "Failed to save image: "+err.Error())
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"url":       uploadsURLPrefix + name,
			"size":      fileHeader.Size,
			"mimeType":  mime,
		})
	}
}
