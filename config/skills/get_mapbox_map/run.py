#!/usr/bin/env python3
import json, os, requests, time

def get_mapbox_map():
    args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
    lat = args.get('lat')
    lon = args.get('lon')
    zoom = args.get('zoom', 14)
    markers = args.get('markers', '')
    
    with open('/app/config/mapbox_config.json', 'r') as f:
        token = json.load(f)['access_token']

    # Mapbox API: markersがあれば /markers/ ... なしなら直接座標
    base_url = "https://api.mapbox.com/styles/v1/mapbox/streets-v11/static"
    if markers:
        # 正しいURL構成: /markers/pin.../lon,lat,zoom/600x400?access_token=...
        url = f"{base_url}/{markers}/{lon},{lat},{zoom}/600x400?access_token={token}"
    else:
        url = f"{base_url}/{lon},{lat},{zoom}/600x400?access_token={token}"
    
    # 簡易リトライ
    for i in range(3):
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                with open("/app/workspace/mapbox_map.png", 'wb') as f:
                    f.write(response.content)
                print("Successfully saved /app/workspace/mapbox_map.png")
                return
            elif response.status_code == 429:
                print(f"Rate limited, retrying... (attempt {i+1})")
                time.sleep(5)
            else:
                print(f"Error {response.status_code}: {response.text}")
                return
        except Exception as e:
            print(f"Request failed: {e}")
            return
    print("Failed after retries.")

if __name__ == "__main__":
    get_mapbox_map()
