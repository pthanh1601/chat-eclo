# ECLO Chat Mobile

React Native client scaffold for ECLO Chat, built from `docs/project-core-logic-react-native.md`.

Before changing UI, navigation, Liquid Glass, chat, friend, group, offline or Matrix behavior, read `docs/design-and-logic-contract.md`. That file is the project contract for design and logic decisions that must not be casually replaced by custom workarounds.

## What is implemented

- React Native TypeScript app structure.
- Native navigation: auth stack, main tabs, chat screen.
- Matrix homeserver default: `https://matrix.5hpc.com`.
- Login, register, restore session and logout flow.
- Session secret storage through Keychain/Keystore, not AsyncStorage.
- Matrix client service with crypto store namespace by `userId + deviceId`.
- Room list, chat timeline mapping, encrypted-send guard through Matrix crypto `prepareToEncrypt`.
- ECLO custom event keys kept in `src/config/matrix.ts`.

## Important E2EE note

This project intentionally does not fake E2EE. If the React Native runtime cannot initialize Matrix Rust crypto/native crypto, encrypted sends fail with a clear error instead of silently sending unsafe plaintext. Before shipping Phase 2, verify Android and iOS release builds can load the chosen crypto backend and can restore old encrypted messages with a Recovery Key.

## Commands

```sh
npm run typecheck
npm test
npm start
npm run android
npm run ios
```

## Next implementation steps

1. Wire a proven Matrix crypto backend for React Native release builds.
2. Add persistent sync and crypto stores backed by native storage.
3. Test encrypted text and media against the web client on two real devices/accounts.
4. Expand contacts, groups, media, recovery, verification, push and calls by the phases in the doc.
