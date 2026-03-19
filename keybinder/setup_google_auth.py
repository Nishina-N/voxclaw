#!/usr/bin/env python3
"""
One-time Google OAuth2 setup script for gemiclaw keybinder.
Run this manually to generate token.json before starting the bot.

Requirements:
  pip install google-auth-oauthlib

Usage:
  cd keybinder
  python3 setup_google_auth.py

Steps:
  1. Download client_secret.json from Google Cloud Console and place it here
     (APIs & Services → Credentials → OAuth 2.0 Client ID → Desktop app → Download JSON)
  2. Run this script — a browser window will open for Google sign-in
  3. After approving access, token.json is saved automatically
  4. Start the bot: docker-compose up -d --build
"""

import json
import os
from datetime import datetime, timezone

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Error: google-auth-oauthlib is not installed.")
    print("Run: pip install google-auth-oauthlib")
    exit(1)

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/tasks",
]

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT_SECRET_PATH = os.path.join(HERE, "client_secret.json")
TOKEN_PATH = os.path.join(HERE, "token.json")


def main():
    if not os.path.exists(CLIENT_SECRET_PATH):
        print(f"Error: {CLIENT_SECRET_PATH} not found.\n")
        print("How to get it:")
        print("  1. Go to https://console.cloud.google.com/")
        print("  2. Select your project (or create one)")
        print("  3. APIs & Services → Enabled APIs → enable Drive API, Calendar API, Sheets API, Tasks API")
        print("  4. APIs & Services → Credentials → Create credentials → OAuth client ID")
        print("  5. Application type: Desktop app")
        print("  6. Download the JSON file → save as keybinder/client_secret.json")
        exit(1)

    print("Starting OAuth2 flow — your browser will open for Google sign-in...")
    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET_PATH, SCOPES)
    creds = flow.run_local_server(port=0)

    # Save in a format compatible with keybinder/server.ts
    expiry_iso = creds.expiry.isoformat() if creds.expiry else datetime.now(timezone.utc).isoformat()

    token_data = {
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "token_uri": creds.token_uri,
        "expiry": expiry_iso,
    }

    with open(TOKEN_PATH, "w") as f:
        json.dump(token_data, f, indent=2)

    print(f"\n✅ token.json saved to {TOKEN_PATH}")
    print("You can now start gemiclaw:")
    print("  docker-compose up -d --build")


if __name__ == "__main__":
    main()
