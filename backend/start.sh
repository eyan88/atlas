#!/bin/bash

# If DATA_PROVIDER is set to thetadata, launch headless ThetaTerminal in background
if [ "${DATA_PROVIDER,,}" = "thetadata" ]; then
    echo "========================================================"
    echo "Starting Headless ThetaTerminal sidecar in background..."
    echo "========================================================"
    
    if [ -n "$THETADATA_USERNAME" ] && [ -n "$THETADATA_PASSWORD" ]; then
        # Generate 2-line creds.txt file required by ThetaTerminal v3
        printf "%s\n%s\n" "$THETADATA_USERNAME" "$THETADATA_PASSWORD" > /app/creds.txt
        echo "Generated /app/creds.txt dynamically from environment variables."
        
        if [ -f "/app/ThetaTerminalv3.jar" ]; then
            java -jar /app/ThetaTerminalv3.jar --creds-file /app/creds.txt &
        else
            java -jar /app/ThetaTerminal.jar --creds-file /app/creds.txt &
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
