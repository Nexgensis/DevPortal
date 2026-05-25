FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o main .

# Minimal runtime image
FROM alpine:3.20

WORKDIR /app
COPY --from=builder /app/main .
# Copy .env file if it exists (optional)
COPY .env* ./

EXPOSE 8080

CMD ["./main"]
