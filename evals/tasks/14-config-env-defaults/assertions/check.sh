#!/bin/bash
if grep -q "DATABASE_POOL_MIN=2" .env.example && grep -q "DATABASE_POOL_MAX=10" .env.example; then
  echo "PASS"
  exit 0
fi
exit 1
