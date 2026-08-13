UPDATE install_tokens
SET superseded_at = created_at
WHERE used_at IS NULL
  AND superseded_at IS NULL;
