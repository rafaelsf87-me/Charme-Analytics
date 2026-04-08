# CATEGORIAS-REVIEWS.md — Dicionário de Classificação de Avaliações
> Referência obrigatória para o módulo de Análise de Avaliações.
> Baseado em 175 avaliações classificadas manualmente pelo Rafael.
> Injetar no system prompt da chamada Claude que classifica reviews.

---

## INSTRUÇÃO PARA O AGENTE CLASSIFICADOR

Classifique cada avaliação negativa em UMA das categorias abaixo. Use EXATAMENTE o nome da categoria listado — não crie variações.

As categorias têm hierarquia: algumas são genéricas (ex: "Qualidade Ruim") e outras são específicas (ex: "Qualidade Ruim - Costura"). **Sempre prefira a categoria ESPECÍFICA quando o texto permitir identificar o subproblema.** Use a genérica só quando o texto é vago demais para determinar o subtipo.

---

## CATEGORIAS (usar exatamente estes nomes)

### 1. Não Recebi (atraso)
Cliente não recebeu o produto ou houve atraso significativo na entrega.

**Palavras-chave típicas:** não recebi, não chegou, nunca entregue, atraso, não foi entregue, até agora nada, cadê meu pedido, código de rastreio, não entregaram, esperando entrega

**Exemplos reais:**
- "Não recebi meu produto."
- "Até agora eu não recebi. Eu pedi dia 27 e até agora nada."
- "Nunca foi entregue"
- "Mandam produto da China, estou me sentindo lesada." (quando o contexto é sobre demora/não recebimento)

### 2. Qualidade Ruim
Insatisfação genérica com qualidade quando NÃO é possível identificar o subtipo específico. **Use esta SÓ quando o texto não permite classificar nas subcategorias abaixo.**

**Palavras-chave típicas:** qualidade ruim, material fraco, péssima qualidade, decepcionei, esperava melhor, propaganda enganosa (sobre qualidade geral), não vale o preço

**Exemplos reais:**
- "Material muito fraco, achei que era melhor"
- "Me decepcionei, esperava um tecido mais encorpado e o acabamento mais caprichado."

### 2a. Qualidade Ruim - Tecido
Reclamação específica sobre o tecido ser fino, fraco, brilhante, plástico ou de má qualidade.

**Palavras-chave típicas:** tecido fino, tecido fraco, tecido brilhante, tecido plástico, material fino, parece plástico

**Exemplos reais:**
- "Tecido de má qualidade"
- "Tecido muito fino. Não protegerá em nada minhas cadeiras."
- "Péssimo acabamento! Tecido brilhante!!!!"

### 2b. Qualidade Ruim - Costura
Problemas com costura, acabamento, fita de ajuste, peças descosturadas.

**Palavras-chave típicas:** costura, descosturada, mal acabada, fita arrebentou, costurada torto, acabamento ruim, falha na costura

**Exemplos reais:**
- "duas capas vieram com falha na costura, ou seja, rasgadas"
- "uma delas veio descosturada na lateral e costurada tudo torto"
- "A fita de ajuste arrebentou."

### 2c. Qualidade Ruim - Rasgou
Produto rasgou, furou, desfiou ou soltou fios em pouco tempo de uso.

**Palavras-chave típicas:** rasgou, furou, desfiando, fios soltos, fios puxados, soltando fio, unha do gato, primeira semana

**Exemplos reais:**
- "Furou na primeira semana"
- "Já está toda desfiando, não tem proteção contra arranhões!"
- "Em uma semana de uso já está cheia de fios soltando devido à unha do gato"

### 2d. Qualidade Ruim - Escorrega
Capa não fica fixa, escorrega, sai do lugar, enruga.

**Palavras-chave típicas:** escorrega, escorregando, não fixa, fica saindo, sai do lugar, enruga, não encaixa, não prendeu, solta

**Exemplos reais:**
- "Não gostei, fica escorregando o tempo todo, enruga tudo no sofá"
- "Não gostei ela fica saindo do sofá"
- "Não fixou, já devolvi"

### 3. Não Serviu
Genérico — capa não serviu no móvel, sem especificar se é grande ou pequena. **Use esta SÓ quando o texto não permite classificar se ficou grande ou pequena.**

**Palavras-chave típicas:** não serviu, não encaixou, não coube (quando não diz se é grande/pequena), não vestiu

**Exemplos reais:**
- "Não encaixou na minha cadeira. Vou precisar fazer uma costura."
- "Não fica presa no sofá, fica saindo" → ATENÇÃO: se o problema é escorregar, usar "Qualidade Ruim - Escorrega". Se é tamanho, usar "Não Serviu".

### 3a. Não Serviu - Pequeno
Capa ficou pequena, apertada, curta, não coube.

**Palavras-chave típicas:** pequena, apertada, curta, não coube, menor que, muito justa, não cobriu

**Exemplos reais:**
- "Não serviu nas minhas cadeiras, acho que por ser mais encorpada e não coube"
- "Ficaram pequenas e minhas cadeiras são padrão, as capas é que estão vindo pequenas"
- "Veio pequena, fiz a devolução"

### 3b. Não Serviu - Grande
Capa ficou grande, solta, sobrando, folgada.

**Palavras-chave típicas:** grande, solta, folgada, imensa, sobrando, enorme, larga demais

**Exemplos reais:**
- "A capa ficou muito solta no sofá"
- "Ficou imensa, sobrando, apesar da minha cadeira estar dentro das medidas"
- "Grande, não é ajustável."

### 4. Cor Errada
Cor recebida diferente da comprada ou variação de cor entre unidades do mesmo pedido.

**Palavras-chave típicas:** cor errada, cor diferente, não é a cor, veio outra cor, cores diferentes, não veio a cor que escolhi

**Exemplos reais:**
- "A cor recebida por mim foi marrom, não veio verde oliva."
- "Pedi 6 capas iguais. Recebi 4 de uma cor e 2 de outra cor."
- "Eu comprei com listas verdes e veio com listas lilás"

### 5. Produto Errado
Recebeu produto/tamanho/modelo diferente do comprado (não é cor — é o item em si).

**Palavras-chave típicas:** capa errada, veio errada, errado, 2 lugares ao invés de 3, produto trocado, mandaram outro

**Exemplos reais:**
- "Recebi uma capa de 2 lugares ao invés de 3 lugares"
- "Veio a capa errada"
- "Encomendei uma capa para sofá de três lugares, enviaram de um lugar"

### 6. Não é Impermeável
Prometido como impermeável mas não protege contra líquidos.

**Palavras-chave típicas:** impermeável, não é impermeável, vazou, molhou, xixi, líquido, água passou

**Exemplos reais:**
- "Acreditamos nessa questão de impermeável, até a cachorra subir no sofá e fazer xixi"
- "Eu achei que realmente era impermeável"
- "Comprei impermeável e recebi normal"

### 7. Pedido Faltando Peça
Pedido incompleto — faltou parte do produto ou do pedido.

**Palavras-chave típicas:** faltando, incompleto, segunda metade, não veio tudo, peça faltando

**Exemplos reais:**
- "Não entregou a segunda metade do meu pedido"

### 8. Dificuldade Utilização
Dificuldade em colocar, instalar ou usar o produto no dia a dia (diferente de "não serviu" — aqui o produto até serve, mas é trabalhoso).

**Palavras-chave típicas:** difícil de colocar, chato de usar, complicado, não fica arrumado, trabalhoso

**Exemplos reais:**
- "É lindo, mas muito chato de usar, o sofá não fica arrumado"

### 9. Comprou Errado (problema unidades)
Cliente se confundiu com o site (quantidade, tamanho) — não é erro da loja, é UX do site.

**Palavras-chave típicas:** 1 unidade, achei que era par, pensei que vinham mais, site confuso, não ficou claro

**Exemplos reais:**
- "Deveriam deixar mais explícito no site que é apenas 1 unidade"

### 10. Outros / Genérico
Usar APENAS quando o texto não se encaixa em NENHUMA das categorias acima. Inclui: pós-venda ruim (sem outro problema específico), avaliação sem informação útil, devolveu sem explicar motivo.

**Palavras-chave típicas:** devolvido, pós-venda, não respondem, atendimento (quando o foco é APENAS atendimento, sem problema de produto)

**Exemplos reais:**
- "Não posso avaliar pois o material foi devolvido"
- "Loja não responde o cliente. Péssima compra, pós-venda deixa a desejar."

---

## REGRAS DE DECISÃO (ORDEM DE PRIORIDADE)

1. **Específica > Genérica:** Se o texto permite identificar o subtipo, use o subtipo. Exemplo: "tecido fino" → "Qualidade Ruim - Tecido" (não "Qualidade Ruim").

2. **Problema principal:** Se a avaliação menciona múltiplos problemas, classifique pelo MAIS GRAVE ou pelo que o cliente mais enfatiza.

3. **Escorrega vs Não Serviu:** Se a capa "sai do lugar" ou "escorrega", é "Qualidade Ruim - Escorrega". Se a capa "não coube" ou "ficou folgada/apertada", é "Não Serviu" (ou seus subtipos).

4. **Cor Errada vs Produto Errado:** Se só a cor veio errada, é "Cor Errada". Se o modelo/tamanho/tipo veio errado, é "Produto Errado".

5. **Atraso + outro problema:** Se o cliente não recebeu E reclama de outra coisa (ex: "não recebi e quando veio era a cor errada"), classificar como "Não Recebi (atraso)" se o foco principal é a não-entrega, ou no outro problema se já recebeu.

6. **Atendimento ruim como problema secundário:** Muitas reviews mencionam "não respondem" + um problema de produto. Classificar pelo problema de produto. Só usar "Outros / Genérico" se a reclamação é EXCLUSIVAMENTE sobre atendimento.

7. **Nunca usar "Não identificado":** Se realmente não conseguir classificar, usar "Outros / Genérico". Sempre deve haver uma categoria.
