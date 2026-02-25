-- Gera/usa um app (via osacompile) que abre o Terminal e inicia o bot.
-- O build script substitui /Users/gaf/projetos/upseller e loja2.

set projectDir to "/Users/gaf/projetos/upseller"
set instanceName to "loja2"

if instanceName is "" or instanceName is "default" then
	set runCmd to "cd " & quoted form of projectDir & " && npm start"
else
	set runCmd to "cd " & quoted form of projectDir & " && UPSELLER_INSTANCE=" & quoted form of instanceName & " npm start -- --instance " & quoted form of instanceName
end if

tell application "Terminal"
	activate
	do script runCmd
end tell
