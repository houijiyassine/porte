name: RC Door Check
on:
  schedule:
    - cron: '* * * * *'
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install web-push @supabase/supabase-js
      - name: Check Door
        env:
          TUYA_CLIENT: ${{ secrets.TUYA_CLIENT }}
          TUYA_SECRET: ${{ secrets.TUYA_SECRET }}
          TUYA_DEVICE_ID: ${{ secrets.TUYA_DEVICE_ID }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          VAPID_PUBLIC: ${{ secrets.VAPID_PUBLIC }}
          VAPID_PRIVATE: ${{ secrets.VAPID_PRIVATE }}
        run: node scripts/check-door.mjs
