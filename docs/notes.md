## Logging
- Best article on pino setup for express [pino](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/)

## Validating
- Article on Zod validations in express [zod-express](https://dev.to/osalumense/validating-request-data-in-expressjs-using-zod-a-comprehensive-guide-3a0j)


## Password Hashing 
- using bcrypt for hashing passwords before storing them.
- salt is the random string added before hashing so that rainbow tables cannot be used to reverse the hash.
- salt rounds determine how many times the hashing algorithm is applied. More rounds mean more security but also more computational time.

## JWT Tokens
- JWT tokens are used for stateless authentication.
- Tokens contain user information and are signed with a secret key.
- Tokens have an expiration time to enhance security.