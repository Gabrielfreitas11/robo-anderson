-- Gera/usa um app (via osacompile) que abre o Terminal e inicia o bot.
-- O build script substitui /Users/gaf/projetos/upseller pelo caminho absoluto do projeto.

set projectDir to "/Users/gaf/projetos/upseller"
set runCmd to "cd " & quoted form of projectDir & " && npm start"

tell application "Terminal"
	activate
	do script runCmd
end tell
