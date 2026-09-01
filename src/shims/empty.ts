/**
 * A stand-in for optional dependencies the Worker bundle can see but never runs.
 *
 * `unzipper` has a lazy `require('@aws-sdk/client-s3')` for reading archives out
 * of S3. Nothing on this deployment reaches that branch, but the bundler still
 * has to resolve it, so it resolves to nothing.
 */
export default {};
