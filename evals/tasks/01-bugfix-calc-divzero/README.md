# Fix divide-by-zero in calculator

**Category:** bugfix

### Prompt
In src/calc.js, divide(a, b) currently divides directly without checking for zero. Update divide(a, b) to throw an Error("Cannot divide by zero") when b === 0.
