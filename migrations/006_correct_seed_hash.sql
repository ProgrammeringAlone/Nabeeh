UPDATE questions SET normalized_hash=encode(sha256(convert_to('ما الاسم التقليدي للمجلس العماني الذي يجتمع فيه الناس للتشاور واستقبال الضيوف','UTF8')),'hex')
WHERE fact_key='sabllah:identity' AND development_only=true;
