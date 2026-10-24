## Unreleased

#### Novidades
- Ver o que conseguiu fazer: clique em 🏆 na barra lateral para ver as tarefas concluídas hoje, ontem, esta semana ou na semana passada, com um gráfico de 10 semanas.
- Altere a data de vencimento ou a data agendada de uma tarefa a partir do menu de contexto.
- Um comando **Alternar tarefa concluída**, ao lado dos de «em andamento» e «cancelada».
- As tarefas que ainda não podem começar ou que esperam por outra tarefa aparecem esbatidas.
- Lê os campos do Tasks no formato Dataview.

## 0.2.7

- Sem alterações. A 0.2.6 foi publicada de novo para ultrapassar um problema nas verificações de publicação do Obsidian.

## 0.2.6

#### Novidades
- **Filtro global de tarefas**: uma caixa de verificação só conta como tarefa se contiver um dos textos indicados, como no plugin Tasks. As opções incluem subtarefas e escondem o texto do filtro no painel.
- **Em andamento e cancelada**: comandos do editor e itens do menu de contexto marcam uma tarefa como em andamento ou cancelada. Executá-los de novo volta a deixá-la aberta.

#### Correções
- As tarefas de notas com fins de linha do Windows não apareciam no painel.
- Cancelar na janela de edição do Tasks apagava a linha da tarefa.
- Para rever perdia uma tarefa acabada de marcar, e as tarefas dispensadas voltavam.
- A pesquisa deixava uma categoria no ecrã quando todas as correspondências nela estavam escondidas.

## 0.2.5

#### Novidades
- **Abrir ligações a partir do painel**: clique numa ligação de uma tarefa para a abrir.

#### Correções
- Os #títulos em wikilinks e os #fragmentos em URL desapareciam do texto da tarefa no painel.

## 0.2.4

#### Novidades
- **Editar tarefa**: abra uma tarefa na janela de edição do plugin Tasks a partir do menu de contexto.
- **Ir para a tarefa**: abrir uma tarefa centra a sua linha, coloca o cursor nela e realça-a brevemente.
- Cada item do menu de contexto tem um ícone quando os menus nativos estão desligados em Definições → Aparência.

## 0.2.3

#### Novidades
- **Mais estados de caixa**: em andamento `[/]`, reencaminhada `[>]` e agendada `[<]` aparecem como tarefas abertas, e cancelada `[-]` conta como concluída.
- O painel mostra os ícones do seu tema para estes estados.

## 0.2.2

#### Novidades
- **Primeiro dia da semana**: escolha-o nas definições, e Esta semana e Próxima semana seguem-no.
- **Exclusões ao analisar todo o cofre**: ignore as pastas e ficheiros escolhidos. As listas de pastas e ficheiros juntam-se numa só.

#### Correções
- As secções próprias das definições voltam a aparecer bem no Obsidian 1.13 e posteriores. A secção «Getting Things Done» chama-se agora «Geral».
- Faltava o distintivo ↖︎ a uma subtarefa cuja tarefa principal não estava no ecrã. A dica agora indica a tarefa principal.

## 0.2.1

#### Novidades
- **Data da tarefa**: coloque as tarefas pela data de vencimento, pela data agendada, pela mais próxima das duas ou por nenhuma.
- **Categorias ordenadas por data**: as tarefas são ordenadas por data dentro de uma categoria, as sem data no fim. Uma categoria ordenada por arrastar e largar mantém a sua ordem.
- **Fixar e desafixar**: fixe uma tarefa numa categoria ou desafixe-a para voltar a seguir as suas datas.
- Marcas separadas de «atrasada» e «mal arquivada», explicadas na janela flutuante.
- **Regra Tudo (apanha o resto)**: apanha cada tarefa com data que as categorias acima não apanharam. Um dia / Talvez tem-na por predefinição.
- Os ícones seguem o Obsidian e o seu tema.

#### Correções
- As notas adicionadas depois de o Obsidian arrancar só apareciam após reiniciar.

## 0.2.0

#### Novidades
- **Uma ordem que dura**: a sua ordem de arrastar sobrevive a edições de ficheiros, mudanças de nome, mudanças de pasta e reinícios.
- **Concluir através do plugin Tasks**: as tarefas recorrentes recebem a próxima ocorrência, e as datas ✅ seguem as regras do Tasks.
- As tarefas concluídas ficam no painel até recarregar.
- **Campos do plugin Tasks**: prioridade, recorrência, datas e ações ao concluir aparecem como distintivos e na janela flutuante, com definições para escolher quais.
- **Marcas de «atrasada» e «mal arquivada»**, e uma linha de vencimento na janela flutuante.
- Um ícone na barra lateral abre o painel.

#### Correções
- Uma tarefa arrastada para outra categoria ficava no sítio errado, e as subtarefas afastavam-se da tarefa principal.
- Abria-se um segundo painel ao recarregar ou atualizar, e as categorias não mudavam à meia-noite.
- Os metadados do plugin Tasks passavam para o texto da tarefa, e surgiam dicas durante o arrastar.
- O plugin pergunta antes de abrir a sua ligação do GitHub para feedback.

## 0.1.9

#### Novidades
- Cada âmbito de análise (todo o cofre, pastas, ficheiros) guarda a sua própria lista.
- Uma mensagem quando não há pastas nem ficheiros escolhidos para analisar.
- As definições de comportamento aparecem na pesquisa de definições do Obsidian (Obsidian 1.13 e posteriores).
- Um banner de agradecimento nas definições, com uma ligação para partilhar feedback e ideias.

#### Correções
- As referências de bloco (^abc123) perdiam-se ao escrever a categoria de uma tarefa.
- Tarefas desatualizadas após mudar o âmbito de análise, e a imagem de celebração que às vezes não aparecia.
- O aviso de mudança de idioma aparecia na primeira instalação.

## 0.1.8

#### Correções
- Abria-se a linha errada de uma tarefa numa nota editada perto do início.

## 0.1.7

#### Novidades
- **12 idiomas**, segundo o idioma do Obsidian.
- Abrir uma tarefa usa o separador da sua nota, se já estiver aberto.
- O texto da tarefa ocupa a linha toda; os botões de movimento rápido aparecem ao passar o rato.

## 0.1.6

#### Novidades
- Passar o rato sobre uma tarefa mostra a sua nota e o número da linha.

## 0.1.5

#### Novidades
- **Pesquisa**: filtre o painel enquanto escreve.
- As versões publicadas são assinadas, para poder confirmar que vêm do código-fonte oficial.

## 0.1.4

#### Correções
- As tarefas sob marcadores simples apareciam como subtarefas de uma tarefa sem relação.

## 0.1.3

#### Novidades
- O texto da tarefa mostra negrito, itálico, rasurado, código, realces e ligações, como nas suas notas.

## 0.1.2

#### Novidades
- As tarefas concluídas têm um botão para as dispensar, e **Dispensar todas** no cabeçalho remove-as de uma vez.

## 0.1.1

#### Novidades
- Os wikilinks no texto da tarefa aparecem no painel.
- Os contadores da barra de estado são clicáveis.

#### Correções
- As dicas das tarefas concluídas, e os movimentos que falhavam por dados de tarefa desatualizados.

## 0.1.0

#### Novidades
- O painel GTD: as tarefas do seu cofre agrupadas em Hoje, Esta semana, Um dia e mais.
- Mova tarefas com um clique ou arrastando e largando.
- As subtarefas acompanham a tarefa principal.
- Contadores de tarefas por categoria na barra de estado.
- Animações de celebração ao concluir uma tarefa.
- Uma vista compacta.
- A categoria é guardada como etiqueta inline (#gtd/today) ou como campo inline do Dataview.
