# Jotform External Field Widget

Custom Widget simples para **mostrar e armazenar no formulário atual o valor de um campo existente noutro formulário Jotform**.

## Configuração do widget

- **IDform**: Form ID do formulário de origem.
- **IDquestion**: QID/ID da pergunta/campo a copiar.
- **SubmissionID**: opcional. Se preenchido, lê exatamente essa submissão. Se vazio, usa a submissão mais recente encontrada no formulário de origem.
- **Placeholder**: texto visual quando o campo não tem valor.

O valor mostrado é `readonly`: o utilizador não o altera. No `submit` do formulário, o próprio widget grava esse valor na submissão do formulário de destino.

## Segurança

A API key Jotform **não é colocada no browser nem no código HTML**. É usada exclusivamente na função server-side `api/value.js` através da variável de ambiente:

`JOTFORM_API_KEY`

## Deploy sugerido: Vercel

1. Criar/importar o projeto na Vercel.
2. Adicionar a variável de ambiente `JOTFORM_API_KEY`.
3. Fazer deploy.
4. Registar/adicionar o Custom Widget no Jotform apontando para o URL público de `index.html`/raiz do deployment, conforme o método usado na conta Jotform.
5. Nas propriedades do widget, preencher o Form ID e o Field/QID de origem.

## Funcionamento

1. Jotform carrega o widget.
2. O widget lê as propriedades configuradas no `manifest.json`.
3. Chama `/api/value` no mesmo domínio.
4. O backend consulta `eu-api.jotform.com` usando a API key protegida.
5. O backend devolve apenas o valor do campo configurado.
6. O widget mostra o valor numa caixa de texto readonly.
7. `JFCustomWidget.sendData()` disponibiliza imediatamente o valor ao formulário.
8. `JFCustomWidget.sendSubmit()` grava o valor quando o formulário é submetido.

## Nota importante sobre Submission ID

Um **Form ID + Field ID** diz qual é o campo, mas não diz de que resposta/submissão esse valor deve ser obtido. Por isso:

- com `SubmissionID`: resultado determinístico;
- sem `SubmissionID`: é usada a submissão mais recente.

Se o objetivo for relacionar automaticamente duas submissões (por exemplo, procurar no formulário de origem pelo mesmo NIF, código, email, Submission ID do primeiro formulário, etc.), deve ser acrescentada uma propriedade de **campo-chave + valor-chave** e aplicar um filtro na API.
