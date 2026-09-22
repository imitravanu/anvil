# Diagnose a contract mismatch across a pricing pipeline

**Category:** multifile

### Prompt
Run the project's tests, diagnose the failure across src/, fix the implementation, and verify that all tests pass. The invoice total comes out as NaN: src/pricing.js and src/invoice.js disagree about the shape they exchange. Make priceItems(items) return { totalCents } where totalCents is the integer sum of item.unitCents * item.quantity, and make invoiceTotal(items, taxRate) read that property and return the integer cents total including tax (rounded).

### Assertion
`assertions/check.sh` runs `node test.js`, which asserts the producer's return
shape directly as well as the consumer's output. Multi-turn diagnostic task: the
NaN surfaces in the consumer, but the fix must land on the shared contract, so a
one-file patch leaves the suite red.
