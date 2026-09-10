# Implement simple bounded cache with size eviction

**Category:** feature

### Prompt
In src/cache.js, implement SimpleCache. It takes maxSize in constructor (default 3), has get(key) returning the value or undefined, and set(key, value). If set causes size > maxSize, delete the oldest set key.
