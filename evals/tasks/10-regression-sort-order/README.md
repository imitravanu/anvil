# Fix inverted priority sort order

**Category:** regression

### Prompt
In src/priority.js, sortByPriority(items) is sorting ascending by mistake. Change the comparator to sort descending so highest priority items come first.
