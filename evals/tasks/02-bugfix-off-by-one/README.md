# Fix off-by-one error in pagination

**Category:** bugfix

### Prompt
In src/paginate.js, paginate(items, page, pageSize) calculates startIndex = page * pageSize when it should be (page - 1) * pageSize. Fix it so page 1 returns the first pageSize items.
