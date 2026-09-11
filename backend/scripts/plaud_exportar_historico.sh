#!/bin/bash
# Roda numa máquina com navegador de verdade (não no sandbox do Claude Code).
# Uso: ./plaud_exportar_historico.sh [pasta_de_saida]
set -euo pipefail

OUT_DIR="${1:-plaud_export_$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$OUT_DIR"

echo "== Login na Plaud (vai abrir o navegador — entra com a conta da Jamilly) =="
npx --yes @plaud-ai/cli login

echo
echo "== Listando todas as gravações =="
page=1
prev_hash=""
while [ "$page" -le 200 ]; do
  out="$OUT_DIR/files_page_$page.txt"
  npx --yes @plaud-ai/cli files --page "$page" --page-size 100 > "$out" 2>&1 || true

  hash="$(md5sum "$out" | cut -d' ' -f1)"
  lines="$(wc -l < "$out")"

  if [ "$lines" -le 2 ] || [ "$hash" = "$prev_hash" ]; then
    rm -f "$out"
    break
  fi

  echo "  página $page salva ($lines linhas)"
  prev_hash="$hash"
  page=$((page + 1))
done

echo
echo "== Pronto =="
echo "Arquivos em: $OUT_DIR"
echo "Compacta essa pasta e manda de volta — a partir dela eu pego os IDs de cada"
echo "gravação e sigo pra próxima etapa (baixar transcrição + resumo de cada uma)."
