# Галерея на Firestore: бюджетная realtime-схема

## Коротко по архитектуре
- Realtime подписки только 2 и только во вкладке галереи:
  1) `gallery_runtime/active` — какой `workId` сейчас активен;
  2) `gallery_works/{workId}` — сама активная работа + агрегированные счетчики реакций.
- История, архив и все реакции **не подписываются**.
- Счетчики реакций (`reactionCounts`) хранятся готовыми в документе работы, не пересчитываются через чтение коллекции реакций.
- Факт реакции пользователя хранится отдельно в `gallery_works/{workId}/reactions/{userId}` — одна реакция на работу.

## Firestore-схема
```text
gallery_runtime/{active}
  workId: string
  changedAt: timestamp

gallery_works/{workId}
  ownerUserId: string
  imageUrl: string
  title: string
  reactionCounts: {
    clap: number,
    heart: number,
    sun: number
  }
  rotationSlot: number
  isActive: boolean
  updatedAt: timestamp

gallery_works/{workId}/reactions/{userId}
  userId: string
  type: "clap" | "heart" | "sun"
  createdAt: timestamp
```

## Что заменить в текущем коде
1. Убрать широкие чтения старой схемы:
   - `db.ref('gallery_compliments').once('value')` в `getGalleryComplimentStats`.
2. Убрать пересчет через обход legacy-ключей `legacyPrefix`.
3. Не вызывать `renderGalleryTab()` после реакции ради обновления счетчика: счетчик приходит realtime из `gallery_works/{workId}`.
4. Оставить live-обновление только внутри вкладки галереи (`switchTab` включает/выключает подписки).

## Почему дешевле
- Нет подписки на весь архив.
- Нет повторных массовых `once('value')` по всем реакциям.
- На игрока в галерее максимум 2 realtime listener.
- Вне вкладки галереи listener = 0.

## Безопасный поток реакции
- Клиент делает optimistic update.
- Клиент вызывает Cloud Function `galleryReact`.
- Функция в транзакции Firestore проверяет:
  - работа еще активна;
  - пользователь не реагировал;
  - пользователь не автор работы.
- Затем пишет реакцию + инкрементирует агрегированный счетчик.
- После этого списывает билеты (ваша серверная логика) и начисляет карму в RTDB.
- При ошибке списания билетов делает rollback (удаляет реакцию и декрементирует счетчик).
