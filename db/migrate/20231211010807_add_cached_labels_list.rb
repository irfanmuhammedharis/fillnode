class AddCachedLabelsList < ActiveRecord::Migration[7.0]
  def change
    add_column :conversations, :cached_label_list, :string
    Conversation.reset_column_information
    caching_module = defined?(ActsAsTaggableOn::Taggable::Cache) ? ActsAsTaggableOn::Taggable::Cache : ActsAsTaggableOn::Taggable::Caching
    caching_module.included(Conversation)
  end
end
