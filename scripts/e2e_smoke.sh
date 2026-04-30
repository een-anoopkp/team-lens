#!/usr/bin/env bash
# Phase-1 end-to-end smoke test. Run after `make backend` + `make frontend`
# are up and at least one /sync/run has completed.
#
# Usage:
#     bash scripts/e2e_smoke.sh
#
# Exits non-zero if any check fails.

set -u

BASE=${TEAMLENS_BASE:-http://localhost:8000/api/v1}
PASS=0
FAIL=0
declare -a FAILURES

check() {
  local name="$1" url="$2" assertion="$3"
  local body
  body=$(curl -s "$url")
  if echo "$body" | python3 -c "import sys, json; d = json.load(sys.stdin); $assertion" 2>/dev/null; then
    echo "  ✓ $name"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name"
    echo "    URL: $url"
    echo "    Body: ${body:0:200}"
    FAIL=$((FAIL+1))
    FAILURES+=("$name")
  fi
}

post_check() {
  local name="$1" url="$2" payload="$3" assertion="$4"
  local body
  body=$(curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$url")
  if echo "$body" | python3 -c "import sys, json; d = json.load(sys.stdin); $assertion" 2>/dev/null; then
    echo "  ✓ $name"
    PASS=$((PASS+1))
    LAST_BODY="$body"
  else
    echo "  ✗ $name"
    echo "    URL: $url"
    echo "    Body: ${body:0:200}"
    FAIL=$((FAIL+1))
    FAILURES+=("$name")
    LAST_BODY=""
  fi
}

echo "=== Health ==="
check "/health configured"   "$BASE/health"               "assert d['configured'] == True"

echo ""
echo "=== Sprints ==="
check "/sprints all"         "$BASE/sprints"              "assert isinstance(d, list) and len(d) > 0"
check "/sprints closed"      "$BASE/sprints?state=closed" "assert all(s['state']=='closed' for s in d)"
check "/sprints/{id}"        "$BASE/sprints/18279"        "assert d['name'].startswith('Search 20')"

echo ""
echo "=== Issues ==="
check "/issues default"             "$BASE/issues?limit=5"       "assert len(d['issues']) > 0 and 'issue_key' in d['issues'][0]"
check "/issues by sprint"           "$BASE/issues?sprint_id=18279&limit=5"  "assert len(d['issues']) > 0"
check "/issues by status"           "$BASE/issues?status_category=done&limit=5"  "assert all(i['status_category']=='done' for i in d['issues'])"
check "/issues no Initiatives"      "$BASE/issues?issue_type=Initiative&limit=5" "assert len(d['issues']) == 0"
check "/issues no Epics"            "$BASE/issues?issue_type=Epic&limit=5"  "assert len(d['issues']) == 0"

echo ""
echo "=== Epics + Initiatives ==="
check "/epics list"          "$BASE/epics?limit=5"        "assert len(d) > 0 and 'issue_count' in d[0]"
check "/initiatives"         "$BASE/initiatives"          "assert len(d) > 0 and 'epic_count' in d[0]"

echo ""
echo "=== People ==="
check "/people active"       "$BASE/people?active=true"   "assert len(d) > 0 and all(p['active'] for p in d)"

echo ""
echo "=== Scope changes ==="
check "/scope-changes"       "$BASE/scope-changes?limit=5" "assert isinstance(d, list)"

echo ""
echo "=== Projects (raw) ==="
check "/projects/raw"        "$BASE/projects/raw"          "assert isinstance(d, list)"

echo ""
echo "=== Sync ==="
check "/sync/status"         "$BASE/sync/status?limit=1"   "assert len(d['runs']) > 0 and d['runs'][0]['status']=='success'"

echo ""
echo "=== Holidays ==="
check "/holidays IN"         "$BASE/holidays?region=IN"    "assert isinstance(d, list)"

echo ""
echo "=== Leaves CRUD round-trip ==="
ACCOUNT_ID=$(curl -s "$BASE/people?active=true" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['account_id'])")
echo "  using account_id=$ACCOUNT_ID"

post_check "POST /leaves create" \
  "$BASE/leaves" \
  "{\"person_account_id\":\"$ACCOUNT_ID\",\"start_date\":\"2026-06-15\",\"end_date\":\"2026-06-17\",\"reason\":\"e2e test\"}" \
  "assert d['id'] > 0 and d['reason'] == 'e2e test'"

if [ -n "${LAST_BODY:-}" ]; then
  LEAVE_ID=$(echo "$LAST_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  check "/leaves list shows new"  "$BASE/leaves?person=$ACCOUNT_ID" \
    "assert any(l['id']==$LEAVE_ID for l in d)"

  body=$(curl -s -X PATCH -H 'Content-Type: application/json' \
    -d '{"reason":"e2e edited"}' "$BASE/leaves/$LEAVE_ID")
  if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['reason']=='e2e edited'" 2>/dev/null; then
    echo "  ✓ PATCH /leaves/{id} edit"
    PASS=$((PASS+1))
  else
    echo "  ✗ PATCH /leaves/{id} edit"
    echo "    Body: ${body:0:200}"
    FAIL=$((FAIL+1))
    FAILURES+=("PATCH /leaves/{id}")
  fi

  status=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/leaves/$LEAVE_ID")
  if [ "$status" = "204" ]; then
    echo "  ✓ DELETE /leaves/{id}"
    PASS=$((PASS+1))
  else
    echo "  ✗ DELETE /leaves/{id} → $status"
    FAIL=$((FAIL+1))
    FAILURES+=("DELETE /leaves/{id}")
  fi
fi

echo ""
echo "=== Future-phase routes (should 404 until later phases) ==="
for ep in metrics/velocity metrics/carry-over metrics/blockers \
          hygiene/epics-no-initiative hygiene/tasks-no-epic hygiene/by-due-date; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/$ep")
  if [ "$STATUS" = "404" ]; then
    echo "  ✓ /$ep → 404 (expected)"
    PASS=$((PASS+1))
  else
    echo "  ✗ /$ep → $STATUS (expected 404)"
    FAIL=$((FAIL+1))
    FAILURES+=("/$ep wrong status")
  fi
done

echo ""
echo "=== Summary ==="
TOTAL=$((PASS+FAIL))
echo "  $PASS / $TOTAL passed"
if [ $FAIL -gt 0 ]; then
  echo "  failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
