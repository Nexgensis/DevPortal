package utils

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "encoding/base64"
    "io"
    "os"
)

func Encrypt(text string) (string, error) {
    key := []byte(os.Getenv("ENCRYPTION_KEY"))
    plaintext := []byte(text)
    block, err := aes.NewCipher(key)
    if err != nil {
        return "", err
    }
    ciphertext := make([]byte, aes.BlockSize+len(plaintext))
    iv := ciphertext[:aes.BlockSize]
    if _, err := io.ReadFull(rand.Reader, iv); err != nil {
        return "", err
    }
    stream := cipher.NewCFBEncrypter(block, iv)
    stream.XORKeyStream(ciphertext[aes.BlockSize:], plaintext)
    return base64.URLEncoding.EncodeToString(ciphertext), nil
}

func Decrypt(cryptoText string) (string, error) {
    key := []byte(os.Getenv("ENCRYPTION_KEY"))
    
    // If no encryption key is set or key is empty, return the text as-is (backward compatibility)
    if len(key) == 0 {
        return cryptoText, nil
    }
    
    ciphertext, err := base64.URLEncoding.DecodeString(cryptoText)
    if err != nil {
        // If base64 decode fails, assume it's plain text (backward compatibility)
        return cryptoText, nil
    }
    
    block, err := aes.NewCipher(key)
    if err != nil {
        return "", err
    }
    
    // Check if ciphertext is long enough
    if len(ciphertext) < aes.BlockSize {
        // Assume it's plain text (backward compatibility)
        return cryptoText, nil
    }
    
    iv := ciphertext[:aes.BlockSize]
    ciphertext = ciphertext[aes.BlockSize:]
    stream := cipher.NewCFBDecrypter(block, iv)
    stream.XORKeyStream(ciphertext, ciphertext)
    return string(ciphertext), nil
}
