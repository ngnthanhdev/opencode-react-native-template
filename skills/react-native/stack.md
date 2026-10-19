# React Native + Expo — Tech Stack

## Core

| Category | Technology | Version |
|----------|-----------|---------|
| Language | TypeScript | 5.x (Strict TS API default từ SDK 58) |
| Framework | React Native (via Expo) | SDK 58 (RN 0.88) |
| Runtime | Expo Go / Dev Client | Latest |
| Bundler | Metro | Built-in (Rust transformer — bundle ~2x nhanh) |
| Navigation | React Navigation | v7 / Expo Router native tabs (stable) |

## Expo Core Packages

| Package | Use When |
|---------|----------|
| `expo-router` | File-based routing (recommended for new apps) |
| `@react-navigation/native` | Classic navigation (stack, tabs, drawer) |
| `expo-notifications` | Push notifications |
| `expo-secure-store` | Secure storage (tokens, sensitive data) |
| `expo-sqlite` | Local SQL database |
| `expo-location` | Geolocation |
| `expo-camera` | Camera access |
| `expo-image-picker` | Pick images from library |
| `expo-file-system` | File read/write |
| `expo-constants` | App config constants |
| `expo-device` | Device info |

## State Management

| Category | Library | Notes |
|----------|---------|-------|
| Global State | Zustand | Simple, no boilerplate |
| Server State | TanStack Query | Cache, refetch, mutations |
| Forms | React Hook Form + Zod | Validation |
| Local Storage | AsyncStorage / MMKV | Simple key-value |
| Complex Storage | SQLite (expo-sqlite) | Relational, offline |

## UI & Styling

| Category | Library | Notes |
|----------|---------|-------|
| Styling | StyleSheet / NativeWind | Native or Tailwind |
| NativeWind | Tailwind for RN | Utility-first |
| UI Components | Tamagui / gluestack | Cross-platform component libs |
| Icons | @expo/vector-icons | Built-in icon set |
| Animations | react-native-reanimated | High-perf animations |
| Gestures | react-native-gesture-handler | Gesture handling |

## Networking

| Category | Library | Notes |
|----------|---------|-------|
| HTTP Client | axios / ky | Interceptors, error handling |
| Real-time | Socket.IO / react-native-sse | WebSocket / SSE |
| GraphQL | Apollo Client | If using GraphQL |
| Local Mock | MSW (mock service worker) | Dev/testing |

## Testing

| Category | Tool |
|----------|------|
| Unit Test | Jest + React Native Testing Library |
| Component | @testing-library/react-native |
| E2E | Maestro (recommended — xem `e2e-maestro.md`) / Detox |
| Coverage | jest coverage |

## Dev & Build

| Category | Tool |
|----------|------|
| Package Manager | npm / pnpm / yarn |
| Linting | ESLint (expo lint) |
| Formatting | Prettier |
| Type Check | tsc --noEmit |
| Build | EAS Build (expo.dev) |
| Submit | EAS Submit |

## Version Pinning

Always pin exact versions in `package.json`:
```json
"dependencies": {
  "expo": "58.0.14",        // ✅ exact — Expo SDK 58 stable
  "react": "19.3.0",       // ✅ exact — theo Expo SDK 58
  "react-native": "0.88.0", // ✅ exact — theo Expo SDK 58
  "expo-router": "58.0.23"  // ✅ exact — core rewrite: data loaders/SSR/native tabs stable
}
```

⚠️ **Dùng `npx expo install` cho native modules** — tự chọn đúng version tương thích SDK. Không tự cài version bừa.

## SDK 58 — điểm cần lưu ý (stable 07/10/2026)
- **Strict TS API default**: type-check chặt hơn, sửa lỗi type ẩn trước khi nâng.
- **Expo Router core rewrite**: data loaders, SSR, native tabs stable — ưu tiên native tabs thay custom tab bar.
- **iOS 27 App Intents + Android widgets** native support.
- **Metro Rust transformer** (bundle ~2x nhanh); AGP 9.
- **EAS CLI v24** đổi scheme một số lệnh — cập nhật lại `.devops/templates/*` khi build thực tế.
- ⚠️ Luôn `npx expo install` để chọn version native modules khớp SDK 58.
