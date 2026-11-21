// Command vaultctl is the operator tool for the admin password vault.
//
//	vaultctl genkey                 print a new random 32-byte key (base64)
//	vaultctl key-usage              rows per key version (is an old key still needed?)
//	vaultctl rotate                 re-encrypt everything onto VAULT_ACTIVE_KEY_VERSION
//	vaultctl reset-mfa <username>   break-glass: clear an admin's MFA
//
// It reads the same env as the API (DB_DSN, VAULT_KEYS, VAULT_ACTIVE_KEY_VERSION).
// In Docker: docker compose exec backend go run ./cmd/vaultctl rotate
// (or build it into the image). Every mutating command is audited.
package main

import (
	"fmt"
	"os"
	"os/user"
	"sort"

	"backend/migrations"
	"backend/vault"
	vcrypto "backend/vault/crypto"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func usage() {
	fmt.Fprintln(os.Stderr, "usage: vaultctl genkey | key-usage | rotate | reset-mfa <username>")
	os.Exit(2)
}

func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "vaultctl: "+format+"\n", a...)
	os.Exit(1)
}

func operator() vault.Actor {
	name := "unknown"
	if u, err := user.Current(); err == nil {
		name = u.Username
	}
	host, _ := os.Hostname()
	return vault.Actor{Username: "cli:" + name + "@" + host, UserAgent: "vaultctl"}
}

func service() *vault.Service {
	ring, err := vcrypto.KeyRingFromEnv()
	if err != nil {
		fail("%v", err)
	}
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		fail("DB_DSN is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		fail("connecting to database: %v", err)
	}
	if err := migrations.CreatePasswordVault(db); err != nil {
		fail("ensuring vault schema: %v", err)
	}
	return vault.NewService(db, ring)
}

func main() {
	_ = godotenv.Load()
	if len(os.Args) < 2 {
		usage()
	}
	switch os.Args[1] {
	case "genkey":
		k, err := vcrypto.GenerateKey()
		if err != nil {
			fail("%v", err)
		}
		fmt.Println(k)
	case "key-usage":
		usage, err := service().KeyVersionUsage()
		if err != nil {
			fail("%v", err)
		}
		versions := make([]int, 0, len(usage))
		for v := range usage {
			versions = append(versions, v)
		}
		sort.Ints(versions)
		if len(versions) == 0 {
			fmt.Println("no encrypted rows yet")
		}
		for _, v := range versions {
			fmt.Printf("key version %d: %d rows\n", v, usage[v])
		}
	case "rotate":
		rep, err := service().RotateKeys(operator())
		if err != nil {
			fail("rotation stopped (safe to re-run): %v", err)
		}
		fmt.Printf("re-encrypted %d credentials and %d MFA secrets onto key version %d\n",
			rep.Credentials, rep.MFASecrets, rep.ActiveVersion)
	case "reset-mfa":
		if len(os.Args) != 3 {
			usage()
		}
		if err := service().ResetMFAByUsername(operator(), os.Args[2]); err != nil {
			fail("%v", err)
		}
		fmt.Printf("MFA cleared for %s; they will be asked to enroll again\n", os.Args[2])
	default:
		usage()
	}
}
