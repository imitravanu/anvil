# Fix off-by-one slice bounds in a Python data processor

**Category:** bugfix

### Prompt
In src/processor.py, chunk(items, size) drops the trailing remainder whenever the input does not divide evenly by `size`, and it also loses whole chunks for evenly divisible input. Fix the slice bounds so every item is returned exactly once, in order, in chunks of at most `size` elements. Keep the existing ValueError for a non-positive size. Assertions run `python3 -m unittest test_processor.py`.

### Assertion
`assertions/check.sh` runs the sandbox's `unittest` suite, which covers exact
division, a trailing remainder, a chunk size larger than the input, empty input,
and the non-positive-size guard.
