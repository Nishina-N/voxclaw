#!/usr/bin/env python3
import json, os, requests, time

def get_mapbox_map():
    args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
    lat = args.get('lat')
    lon = args.get('lon')
    zoom = args.get('zoom', 14)
    markers = args.get('markers', '')
    
    import urllib.request
    # keybinder 経由で Mapbox 画像を取得（base64 で返る）
    kb_url = f"http://keybinder:3001/mapbox/static?lat={lat}&lon={lon}&zoom={zoom}"
    if markers:
        kb_url += f"&markers={requests.utils.quote(markers)}"

    # 簡易リトライ
    for i in range(3):
        try:
            response = requests.get(kb_url, timeout=15)
            if response.status_code == 200:
                import base64
                data = response.json()
                img_bytes = base64.b64decode(data['image_base64'])
                with open("/app/workspace/mapbox_map.png", 'wb') as f:
                    f.write(img_bytes)
                print("/app/workspace/mapbox_map.png")
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
