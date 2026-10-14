-- Preserve the original fixture identity while including its actual options.
UPDATE questions SET normalized_hash=encode(sha256(convert_to(normalized_hash||':ordering:["3","7","9"]','UTF8')),'hex')
 WHERE fact_key='ordering:3-7-9' AND format='ordering' AND development_only;
