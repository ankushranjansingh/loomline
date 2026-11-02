#!/bin/sh
# Rebuilds the single-file app (index.html) from the parts in src/.
cd "$(dirname "$0")"
{ cat src/head.html; cat src/body.html; echo '<script>'; cat src/engine.js; echo '</script>'; echo '<script>'; cat src/app.js; echo '</script>'; echo '</body></html>'; } > index.html
echo "Built index.html"
