urwhaturead.com {
    encode gzip zstd

    handle /api/* {
        reverse_proxy 127.0.0.1:8080
    }

    handle /healthz {
        reverse_proxy 127.0.0.1:8080
    }

    handle {
        root * /opt/quick/frontend/dist
        try_files {path} /index.html
        file_server
    }
}

