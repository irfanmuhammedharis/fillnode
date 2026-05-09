class SuperAdmin::PlatformBannersController < SuperAdmin::ApplicationController
  before_action :ensure_fillnode_cloud

  private

  def ensure_fillnode_cloud
    raise ActionController::RoutingError, 'Not Found' unless FillnodeApp.fillnode_cloud?
  end
end
