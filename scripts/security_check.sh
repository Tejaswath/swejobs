#!/usr/bin/env bash
set -euo pipefail

if rg -n "SUPABASE_SERVICE_ROLE_KEY|service_role" src; then
  echo "[FAIL] service role references found in frontend src/"
  exit 1
fi

echo "[OK] no service role key references in frontend src/"
