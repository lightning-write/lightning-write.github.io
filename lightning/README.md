# 내 라이트닝 페이지 만들기

라이트닝 페이지는 claude.ai 안에서 돌아가는 MYWONGO의 짝입니다. 번개(이어 쓰기), build(싹 정리), bricks(조각), 스토밍(개요)을 여기서 하고, 원고는 구글 드라이브를 거쳐 앱과 오갑니다.

라이트닝 페이지는 **사람마다 자기 claude.ai 계정에 하나씩** 만들어 씁니다. 남의 페이지를 공유받으면 Claude와 드라이브 기능이 작동하지 않습니다. 내 페이지에서 쓰는 번개·스토밍·build는 내 claude.ai 계정의 사용량만 씁니다.

## 준비

1. **앱에서 드라이브 연결**: [MYWONGO](https://zax-zac.github.io/Wongo/)를 열고, 원고 목록 아래 **드라이브 연결**로 내 구글 계정을 연결합니다.
   - 로그인이 막히면 앱 주인에게 내 Gmail 주소를 알려 주세요. 앱 주인이 구글 클라우드의 테스트 사용자에 넣어야 로그인됩니다(최대 100명).
2. **claude.ai에 Google Drive 커넥터 연결**: claude.ai 설정의 커넥터에서 Google Drive를 연결합니다. 1번과 **같은 구글 계정**이어야 앱과 같은 원고를 봅니다.

## 페이지 만들기

claude.ai에서 Claude에게 이렇게 부탁합니다.

> github.com/zax-zac/Wongo 저장소의 `lightning/lightning-page.html`을 내 계정의 아티팩트로 올려 줘. 같은 폴더의 글꼴 `kopub-batang-light.woff`도 같은 이름으로 함께 올리고, 내용은 고치지 마. capabilities는 아래 그대로 해 줘.

```json
{
  "sample": {},
  "mcp": {"servers": [{"server": "Google Drive", "tools": ["search_files", "download_file_content", "create_file", "trash_file"]}]}
}
```

- 페이지를 처음 열면 Claude 사용과 Google Drive 사용을 허락할지 묻습니다. 둘 다 허락합니다.
- 원고 목록이 뜨면 됩니다. 앱에서 드라이브 연결을 해 두었다면 앱의 원고가 보입니다.

## 앱과 잇기

1. 만든 페이지를 열고, 주소창의 주소(`https://claude.ai/artifact/…`)를 복사합니다.
2. 앱에서 **번개 아이콘**(툴바 맨 끝)을 누르면 주소를 넣는 칸이 뜹니다. 붙여 넣고 **저장하고 열기**를 누릅니다.
   - 주소는 그 기기에만 저장됩니다. 컴퓨터·휴대폰·태블릿마다 한 번씩 넣습니다.
   - 나중에 바꾸려면 원고 목록 아래 **라이트닝 주소**를 누릅니다.

이제 앱의 번개를 누르면 지금 원고를 보내고 내 라이트닝 페이지가 열리며, 페이지가 그 원고를 바로 엽니다.

## 원고는 어디에 있나

원고는 claude.ai가 아니라 **내 구글 드라이브의 `MYWONGO` 폴더**에 있습니다. 앱 주인을 포함해 다른 사람의 원고와 섞이지 않습니다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `lightning-page.html` | 라이트닝 페이지 본체 |
| `kopub-batang-light.woff` | 원고 글꼴(KoPub 바탕 Light) |
