// Protocolo de progresso compartilhado entre backend (claude.ts) e frontend (chat-interface.tsx)
// Marcadores embutidos no stream de texto e filtrados pelo frontend antes de exibir
export const PROGRESS_PREFIX = '\x00PROGRESS:';
