#!/bin/sh
# /secrets はホストの keybinder/secrets/ にマウントされている
# keys.json がなければ example からコピーして初期化する
if [ ! -f /secrets/keys.json ]; then
    echo '[keybinder] keys.json not found, creating from example...'
    cp /app/secrets_for_skills.example.json /secrets/keys.json
fi
exec "$@"
