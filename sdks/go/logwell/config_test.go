package logwell

import (
    "net/http"
    "testing"
    "time"
)

// validAPIKey returns a valid API key for testing.
func validAPIKey() string {
    return "lw_" + "abcdefghijklmnopqrstuvwxyz123456" // 32 chars after lw_
}

// validEndpoint returns a valid endpoint for testing.
func validEndpoint() string {
    return "http://localhost:3000"
}

func TestNewDefaultConfig(t *testing.T) {
    t.Run("creates config with correct defaults", func(t *testing.T) {
        cfg := newDefaultConfig(validEndpoint(), validAPIKey())

        if cfg.Endpoint != validEndpoint() {
            t.Errorf("Endpoint = %q, want %q", cfg.Endpoint, validEndpoint())
        }
        if cfg.APIKey != validAPIKey() {
            t.Errorf("APIKey = %q, want %q", cfg.APIKey, validAPIKey())
        }
        if cfg.BatchSize != DefaultBatchSize {
            t.Errorf("BatchSize = %d, want %d", cfg.BatchSize, DefaultBatchSize)
        }
        if cfg.FlushInterval != DefaultFlushInterval {
            t.Errorf("FlushInterval = %v, want %v", cfg.FlushInterval, DefaultFlushInterval)
        }
        if cfg.MaxQueueSize != DefaultMaxQueueSize {
            t.Errorf("MaxQueueSize = %d, want %d", cfg.MaxQueueSize, DefaultMaxQueueSize)
        }
        if cfg.MaxRetries != DefaultMaxRetries {
            t.Errorf("MaxRetries = %d, want %d", cfg.MaxRetries, DefaultMaxRetries)
        }
        if cfg.CaptureSourceLocation != false {
            t.Errorf("CaptureSourceLocation = %v, want false", cfg.CaptureSourceLocation)
        }
        if cfg.HTTPClient != http.DefaultClient {
            t.Errorf("HTTPClient = %v, want http.DefaultClient", cfg.HTTPClient)
        }
    })

    t.Run("default values match constants", func(t *testing.T) {
        if DefaultBatchSize != 10 {
            t.Errorf("DefaultBatchSize = %d, want 10", DefaultBatchSize)
        }
        if DefaultFlushInterval != 5*time.Second {
            t.Errorf("DefaultFlushInterval = %v, want 5s", DefaultFlushInterval)
        }
        if DefaultMaxQueueSize != 1000 {
            t.Errorf("DefaultMaxQueueSize = %d, want 1000", DefaultMaxQueueSize)
        }
        if DefaultMaxRetries != 3 {
            t.Errorf("DefaultMaxRetries = %d, want 3", DefaultMaxRetries)
        }
    })
}

func TestConfigValidateAPIKey(t *testing.T) {
    tests := []struct {
        name      string
        apiKey    string
        wantError bool
    }{
        // Valid API keys
        {
            name:      "valid with lowercase alphanumeric",
            apiKey:    "lw_abcdefghijklmnopqrstuvwxyz123456",
            wantError: false,
        },
        {
            name:      "valid with uppercase",
            apiKey:    "lw_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
            wantError: false,
        },
        {
            name:      "valid with mixed case",
            apiKey:    "lw_AbCdEfGhIjKlMnOpQrStUvWxYz123456",
            wantError: false,
        },
        {
            name:      "valid with hyphens",
            apiKey:    "lw_abcdefghij-klmnopqrst-uvwxyz1234",
            wantError: false,
        },
        {
            name:      "valid with underscores",
            apiKey:    "lw_abcdefghij_klmnopqrst_uvwxyz1234",
            wantError: false,
        },
        {
            name:      "valid with mixed special chars",
            apiKey:    "lw_abc-def_ghi-jkl_mno-pqr_stu-vwx12",
            wantError: false,
        },
        {
            name:      "valid with exactly 32 chars after prefix",
            apiKey:    "lw_12345678901234567890123456789012",
            wantError: false,
        },
        {
            name:      "valid with more than 32 chars after prefix",
            apiKey:    "lw_1234567890123456789012345678901234567890",
            wantError: false,
        },

        // Invalid API keys
        {
            name:      "empty",
            apiKey:    "",
            wantError: true,
        },
        {
            name:      "wrong prefix lx_",
            apiKey:    "lx_abcdefghijklmnopqrstuvwxyz123456",
            wantError: true,
        },
        {
            name:      "wrong prefix LW_",
            apiKey:    "LW_abcdefghijklmnopqrstuvwxyz123456",
            wantError: true,
        },
        {
            name:      "missing prefix",
            apiKey:    "abcdefghijklmnopqrstuvwxyz123456",
            wantError: true,
        },
        {
            name:      "too short (31 chars after prefix)",
            apiKey:    "lw_1234567890123456789012345678901",
            wantError: true,
        },
        {
            name:      "way too short",
            apiKey:    "lw_abc",
            wantError: true,
        },
        {
            name:      "only prefix",
            apiKey:    "lw_",
            wantError: true,
        },
        {
            name:      "invalid char space",
            apiKey:    "lw_abcdefghijklmnopqrstuvwxyz12345 ",
            wantError: true,
        },
        {
            name:      "invalid char exclamation",
            apiKey:    "lw_abcdefghijklmnopqrstuvwxyz12345!",
            wantError: true,
        },
        {
            name:      "invalid char at sign",
            apiKey:    "lw_abcdefghijklmnopqrstuvwxyz12345@",
            wantError: true,
        },
        {
            name:      "invalid char dot",
            apiKey:    "lw_abcdefghijklmnopqrstuvwxyz.12345",
            wantError: true,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            cfg := newDefaultConfig(validEndpoint(), tt.apiKey)
            err := validateConfig(cfg)

            if tt.wantError && err == nil {
                t.Errorf("validateConfig() error = nil, want error for apiKey %q", tt.apiKey)
            }
            if !tt.wantError && err != nil {
                t.Errorf("validateConfig() error = %v, want nil for apiKey %q", err, tt.apiKey)
            }

            // Check error type for invalid cases
            if tt.wantError && err != nil {
                logwellErr, ok := err.(*Error)
                if !ok {
                    t.Errorf("error is not *Error type")
                } else if logwellErr.Code != ErrInvalidConfig {
                    t.Errorf("error code = %v, want %v", logwellErr.Code, ErrInvalidConfig)
                }
            }
        })
    }
}

func TestConfigValidateEndpoint(t *testing.T) {
    tests := []struct {
        name      string
        endpoint  string
        wantError bool
    }{
        // Valid endpoints
        {
            name:      "http localhost with port",
            endpoint:  "http://localhost:3000",
            wantError: false,
        },
        {
            name:      "https with domain",
            endpoint:  "https://logs.example.com",
            wantError: false,
        },
        {
            name:      "https with subdomain",
            endpoint:  "https://api.logs.example.com",
            wantError: false,
        },
        {
            name:      "http with IP",
            endpoint:  "http://192.168.1.1:8080",
            wantError: false,
        },
        {
            name:      "https with path",
            endpoint:  "https://example.com/api/logs",
            wantError: false,
        },
        {
            name:      "http localhost no port",
            endpoint:  "http://localhost",
            wantError: false,
        },

        // Invalid endpoints
        {
            name:      "empty",
            endpoint:  "",
            wantError: true,
        },
        {
            name:      "missing scheme",
            endpoint:  "localhost:3000",
            wantError: true,
        },
        {
            name:      "missing scheme with domain",
            endpoint:  "logs.example.com",
            wantError: true,
        },
        {
            name:      "ftp scheme",
            endpoint:  "ftp://logs.example.com",
            wantError: true,
        },
        {
            name:      "ws scheme",
            endpoint:  "ws://logs.example.com",
            wantError: true,
        },
        {
            name:      "wss scheme",
            endpoint:  "wss://logs.example.com",
            wantError: true,
        },
        {
            name:      "scheme only",
            endpoint:  "http://",
            wantError: true,
        },
        {
            name:      "file scheme",
            endpoint:  "file:///path/to/file",
            wantError: true,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            cfg := newDefaultConfig(tt.endpoint, validAPIKey())
            err := validateConfig(cfg)

            if tt.wantError && err == nil {
                t.Errorf("validateConfig() error = nil, want error for endpoint %q", tt.endpoint)
            }
            if !tt.wantError && err != nil {
                t.Errorf("validateConfig() error = %v, want nil for endpoint %q", err, tt.endpoint)
            }

            // Check error type for invalid cases
            if tt.wantError && err != nil {
                logwellErr, ok := err.(*Error)
                if !ok {
                    t.Errorf("error is not *Error type")
                } else if logwellErr.Code != ErrInvalidConfig {
                    t.Errorf("error code = %v, want %v", logwellErr.Code, ErrInvalidConfig)
                }
            }
        })
    }
}

func TestConfigValidateBatchSize(t *testing.T) {
    tests := []struct {
        name      string
        batchSize int
        wantError bool
    }{
        // Valid values
        {"minimum valid (1)", 1, false},
        {"maximum valid (500)", 500, false},
        {"mid range (100)", 100, false},
        {"default value (10)", 10, false},

        // Invalid values
        {"zero", 0, true},
        {"negative", -1, true},
        {"above max (501)", 501, true},
        {"way above max (1000)", 1000, true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            cfg := newDefaultConfig(validEndpoint(), validAPIKey())
            cfg.BatchSize = tt.batchSize
            err := validateConfig(cfg)

            if tt.wantError && err == nil {
                t.Errorf("validateConfig() error = nil, want error for batchSize %d", tt.batchSize)
            }
            if !tt.wantError && err != nil {
                t.Errorf("validateConfig() error = %v, want nil for batchSize %d", err, tt.batchSize)
            }
        })
    }
}

func TestConfigValidateFlushInterval(t *testing.T) {
    tests := []struct {
        name          string
        flushInterval time.Duration
        wantError     bool
    }{
        // Valid values
        {"minimum valid (100ms)", 100 * time.Millisecond, false},
        {"maximum valid (60s)", 60 * time.Second, false},
        {"mid range (5s)", 5 * time.Second, false},
        {"1 second", 1 * time.Second, false},
        {"500ms", 500 * time.Millisecond, false},
        {"30 seconds", 30 * time.Second, false},

        // Invalid values
        {"zero", 0, true},
        {"below min (99ms)", 99 * time.Millisecond, true},
        {"below min (50ms)", 50 * time.Millisecond, true},
        {"above max (61s)", 61 * time.Second, true},
        {"way above max (2min)", 2 * time.Minute, true},
        {"negative", -1 * time.Second, true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            cfg := newDefaultConfig(validEndpoint(), validAPIKey())
            cfg.FlushInterval = tt.flushInterval
            err := validateConfig(cfg)

            if tt.wantError && err == nil {
                t.Errorf("validateConfig() error = nil, want error for flushInterval %v", tt.flushInterval)
            }
            if !tt.wantError && err != nil {
                t.Errorf("validateConfig() error = %v, want nil for flushInterval %v", err, tt.flushInterval)
            }
        })
    }
}

func TestConfigValidateMaxQueueSize(t *testing.T) {
    tests := []struct {
        name         string
        maxQueueSize int
        wantError    bool
    }{
        // Valid values
        {"minimum valid (1)", 1, false},
        {"maximum valid (10000)", 10000, false},
        {"mid range (5000)", 5000, false},
        {"default value (1000)", 1000, false},

        // Invalid values
        {"zero", 0, true},
        {"negative", -1, true},
        {"above max (10001)", 10001, true},
        {"way above max (20000)", 20000, true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            cfg := newDefaultConfig(validEndpoint(), validAPIKey())
            cfg.MaxQueueSize = tt.maxQueueSize
            err := validateConfig(cfg)

            if tt.wantError && err == nil {
                t.Errorf("validateConfig() error = nil, want error for maxQueueSize %d", tt.maxQueueSize)
            }
            if !tt.wantError && err != nil {
                t.Errorf("validateConfig() error = %v, want nil for maxQueueSize %d", err, tt.maxQueueSize)
            }
        })
    }
}

func TestConfigValidateMaxRetries(t *testing.T) {
    tests := []struct {
        name       string
        maxRetries int
        wantError  bool
    }{
        // Valid values
        {"minimum valid (0)", 0, false},
        {"maximum valid (10)", 10, false},
        {"mid range (5)", 5, false},
        {"default value (3)", 3, false},
        {"one", 1, false},

        // Invalid values
        {"negative", -1, true},
        {"above max (11)", 11, true},
        {"way above max (100)", 100, true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            cfg := newDefaultConfig(validEndpoint(), validAPIKey())
            cfg.MaxRetries = tt.maxRetries
            err := validateConfig(cfg)

            if tt.wantError && err == nil {
                t.Errorf("validateConfig() error = nil, want error for maxRetries %d", tt.maxRetries)
            }
            if !tt.wantError && err != nil {
                t.Errorf("validateConfig() error = %v, want nil for maxRetries %d", err, tt.maxRetries)
            }
        })
    }
}

func TestConfigOptions(t *testing.T) {
    t.Run("WithBatchSize", func(t *testing.T) {
        cfg := &Config{}
        WithBatchSize(50)(cfg)
        if cfg.BatchSize != 50 {
            t.Errorf("BatchSize = %d, want 50", cfg.BatchSize)
        }
    })

    t.Run("WithFlushInterval", func(t *testing.T) {
        cfg := &Config{}
        WithFlushInterval(10 * time.Second)(cfg)
        if cfg.FlushInterval != 10*time.Second {
            t.Errorf("FlushInterval = %v, want 10s", cfg.FlushInterval)
        }
    })

    t.Run("WithMaxQueueSize", func(t *testing.T) {
        cfg := &Config{}
        WithMaxQueueSize(5000)(cfg)
        if cfg.MaxQueueSize != 5000 {
            t.Errorf("MaxQueueSize = %d, want 5000", cfg.MaxQueueSize)
        }
    })

    t.Run("WithMaxRetries", func(t *testing.T) {
        cfg := &Config{}
        WithMaxRetries(5)(cfg)
        if cfg.MaxRetries != 5 {
            t.Errorf("MaxRetries = %d, want 5", cfg.MaxRetries)
        }
    })

    t.Run("WithService", func(t *testing.T) {
        cfg := &Config{}
        WithService("my-service")(cfg)
        if cfg.Service != "my-service" {
            t.Errorf("Service = %q, want %q", cfg.Service, "my-service")
        }
    })

    t.Run("WithMetadata", func(t *testing.T) {
        cfg := &Config{}
        meta := map[string]any{"env": "test", "version": "1.0"}
        WithMetadata(meta)(cfg)
        if cfg.Metadata["env"] != "test" || cfg.Metadata["version"] != "1.0" {
            t.Errorf("Metadata = %v, want %v", cfg.Metadata, meta)
        }
    })

    t.Run("WithCaptureSourceLocation", func(t *testing.T) {
        cfg := &Config{}
        WithCaptureSourceLocation(true)(cfg)
        if cfg.CaptureSourceLocation != true {
            t.Errorf("CaptureSourceLocation = %v, want true", cfg.CaptureSourceLocation)
        }
    })

    t.Run("WithHTTPClient", func(t *testing.T) {
        cfg := &Config{}
        customClient := &http.Client{Timeout: 30 * time.Second}
        WithHTTPClient(customClient)(cfg)
        if cfg.HTTPClient != customClient {
            t.Errorf("HTTPClient = %v, want custom client", cfg.HTTPClient)
        }
    })

    t.Run("WithOnError", func(t *testing.T) {
        cfg := &Config{}
        called := false
        fn := func(*Error) { called = true }
        WithOnError(fn)(cfg)
        if cfg.OnError == nil {
            t.Error("OnError = nil, want function")
        }
        cfg.OnError(nil)
        if !called {
            t.Error("OnError was not called")
        }
    })

    t.Run("WithOnFlush", func(t *testing.T) {
        cfg := &Config{}
        count := 0
        fn := func(n int) { count = n }
        WithOnFlush(fn)(cfg)
        if cfg.OnFlush == nil {
            t.Error("OnFlush = nil, want function")
        }
        cfg.OnFlush(42)
        if count != 42 {
            t.Errorf("OnFlush count = %d, want 42", count)
        }
    })
}

func TestConfigValidationBounds(t *testing.T) {
    t.Run("bounds constants are correct", func(t *testing.T) {
        // BatchSize bounds
        if MinBatchSize != 1 {
            t.Errorf("MinBatchSize = %d, want 1", MinBatchSize)
        }
        if MaxBatchSize != 500 {
            t.Errorf("MaxBatchSize = %d, want 500", MaxBatchSize)
        }

        // FlushInterval bounds
        if MinFlushInterval != 100*time.Millisecond {
            t.Errorf("MinFlushInterval = %v, want 100ms", MinFlushInterval)
        }
        if MaxFlushInterval != 60*time.Second {
            t.Errorf("MaxFlushInterval = %v, want 60s", MaxFlushInterval)
        }

        // MaxQueueSize bounds
        if MinMaxQueueSize != 1 {
            t.Errorf("MinMaxQueueSize = %d, want 1", MinMaxQueueSize)
        }
        if MaxMaxQueueSize != 10000 {
            t.Errorf("MaxMaxQueueSize = %d, want 10000", MaxMaxQueueSize)
        }

        // MaxRetries bounds
        if MinMaxRetries != 0 {
            t.Errorf("MinMaxRetries = %d, want 0", MinMaxRetries)
        }
        if MaxMaxRetries != 10 {
            t.Errorf("MaxMaxRetries = %d, want 10", MaxMaxRetries)
        }
    })
}

func TestConfigValidationMultipleErrors(t *testing.T) {
    t.Run("validation fails fast on first error", func(t *testing.T) {
        // Empty endpoint AND empty API key - should fail on endpoint first
        cfg := &Config{
            Endpoint:      "",
            APIKey:        "",
            BatchSize:     DefaultBatchSize,
            FlushInterval: DefaultFlushInterval,
            MaxQueueSize:  DefaultMaxQueueSize,
            MaxRetries:    DefaultMaxRetries,
        }
        err := validateConfig(cfg)
        if err == nil {
            t.Error("validateConfig() error = nil, want error")
        }
        logwellErr, ok := err.(*Error)
        if !ok {
            t.Fatal("error is not *Error type")
        }
        // Should fail on endpoint first (checked before API key)
        if logwellErr.Message != "endpoint is required" {
            t.Errorf("error message = %q, want 'endpoint is required'", logwellErr.Message)
        }
    })
}
