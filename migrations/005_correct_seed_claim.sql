-- Keep canonical identity/exposures; remove an unsupported UNESCO/date assertion.
UPDATE questions SET text='ما الاسم التقليدي للمجلس العُماني الذي يجتمع فيه الناس للتشاور واستقبال الضيوف؟',hint='يبدأ بالسين، وهو من تقاليد المجتمع العُماني.'
WHERE fact_key='sabllah:identity' AND development_only=true;
