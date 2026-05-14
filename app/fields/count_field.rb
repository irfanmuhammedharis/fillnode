require 'administrate/field/base'

class CountField < Administrate::Field::Base
  def to_s
    precomputed_count || data.count
  end

  private

  def precomputed_count
    count_attr = :"#{attribute}_count"
    resource.respond_to?(count_attr) ? resource.public_send(count_attr) : nil
  end
end
