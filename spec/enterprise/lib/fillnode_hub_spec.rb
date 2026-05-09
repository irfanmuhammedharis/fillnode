require 'rails_helper'

RSpec.describe FillnodeHub do
  describe '.base_url' do
    it 'uses the static hub url outside development for enterprise edition' do
      with_modified_env FILLNODE_HUB_URL: 'https://custom.example.com' do
        allow(Rails).to receive(:env).and_return(ActiveSupport::StringInquirer.new('production'))

        expect(described_class.base_url).to eq('https://hub.2.fillnode.com')
      end
    end

    it 'uses FILLNODE_HUB_URL in development for enterprise edition' do
      with_modified_env FILLNODE_HUB_URL: 'https://custom.example.com' do
        allow(Rails).to receive(:env).and_return(ActiveSupport::StringInquirer.new('development'))

        expect(described_class.base_url).to eq('https://custom.example.com')
      end
    end
  end
end
