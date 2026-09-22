# Implement a type-safe generic event emitter

**Category:** feature

### Prompt
In src/emitter.ts, implement EventEmitter<Events extends Record<string, unknown>> with on(event, listener), off(event, listener), once(event, listener), and emit(event, payload). Payload types must be derived from the event map, so emitting a payload of the wrong type must not compile. once(event, listener) must fire at most once, and off(event, listener) must unsubscribe an existing listener. Assertions type-check the project and then run test.ts.

### Assertion
`assertions/check.sh` compiles the project with the workspace's own `tsc`
(`strict: true`, `noEmitOnError: true`) and then runs the compiled `test.ts` on
Node. The type-safety contract is enforced by a `@ts-expect-error` directive in
`test.ts`: if the emitter degrades to a permissive type, that directive becomes
unused and the type check fails.
