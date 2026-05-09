json.partial! 'api/v1/models/account', formats: [:json], resource: @account
json.latest_fillnode_version @latest_fillnode_version
json.partial! 'enterprise/api/v1/accounts/partials/account', account: @account if FillnodeApp.enterprise?
