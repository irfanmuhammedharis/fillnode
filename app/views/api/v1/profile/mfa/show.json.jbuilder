json.feature_available Fillnode.mfa_enabled?
json.enabled @user.mfa_enabled?
json.backup_codes_generated @user.mfa_service.backup_codes_generated? if Fillnode.mfa_enabled?
