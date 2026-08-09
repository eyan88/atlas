#!/bin/bash

# If DATA_PROVIDER is set to thetadata, launch headless ThetaTerminal in background
if [ "${DATA_PROVIDER,,}" = "thetadata" ]; then
    echo "========================================================"
    echo "Starting Headless ThetaTerminal sidecar in background..."
    echo "========================================================"
    
    if [ -n "$THETADATA_USERNAME" ] && [ -n "$THETADATA_PASSWORD" ]; then
        if [ -f "/app/ThetaTerminalv3.jar" ]; then
            java -jar /app/ThetaTerminalv3.jar --username="$THETADATA_USERNAME" --password="$THETADATA_PASSWORD" &
        else
            java -jar /app/ThetaTerminal.jar --username="$THETADATA_USERNAME" --password="$THETADATA_PASSWORD" &
        fi
        echo "ThetaTerminal v3 launched in background on 127.0.0.1:25510."
        echo "Waiting 5 seconds for ThetaTerminal to initialize..."
        sleep 5
    else
        echo "WARNING: THETADATA_USERNAME or THETADATA_PASSWORD env vars not set!"
    fi
fi

# Launch FastAPI Uvicorn Server
echo "Starting FastAPI Uvicorn Application..."
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
